import CryptoKit
import Darwin
import Foundation
import Security

private let bindingSchemaVersion = 3
private let credentialSchemaVersion = 1
private let bindingPurpose = "automation-actor-launcher"
private let bindingHandoff = "keychain-to-canonical-lease"
private let attestationProtocol = "freed-actor-launcher-readiness-v2"
private let attestationPurpose = "automation-actor-launcher-readiness"
private let credentialPurpose = "automation-actor-lease"
private let keychainService = "freed-automation-actor"
private let productionBindingRoot =
  "/Library/Application Support/Freed/automation-actor-launchers"
private let productionRuntimeRoot =
  "/Library/Application Support/Freed/automation-actor-runtimes"
private let leaseLifetimeMilliseconds = 30 * 60 * 1_000
private let leaseLifetimeSeconds = 30 * 60
private let maximumBindingBytes = 32 * 1_024
private let maximumCredentialBytes = 4 * 1_024
private let maximumControlOutputBytes = 64 * 1_024
private let controlTimeoutMilliseconds: UInt64 = 10 * 1_000
#if AUTOMATION_ACTOR_HOST_TESTING
  private let testControlTimeoutMilliseconds: UInt64 = 250
  private let nativeAcquisitionWindowMilliseconds: UInt64 = 2_500
  private let nativeCleanupReserveMilliseconds: UInt64 = 1_800
  private let testKeychainDelayMicroseconds: useconds_t = 500 * 1_000
  private let testExhaustedKeychainDelayMicroseconds: useconds_t = 2_550 * 1_000
#else
  // Validation and Keychain work share the acquisition window. Once an
  // acquire child may have run, the final 45 seconds belong only to two
  // exact-token release attempts and two absence inspections.
  private let nativeAcquisitionWindowMilliseconds: UInt64 = 20 * 1_000
  private let nativeCleanupReserveMilliseconds: UInt64 = 45 * 1_000
#endif
private let nativeLifecycleBudgetMilliseconds =
  nativeAcquisitionWindowMilliseconds + nativeCleanupReserveMilliseconds
#if AUTOMATION_ACTOR_HOST_TESTING
  private let fakeCredential =
    Data("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".utf8)
#endif

private let actorLeaseNames: [String: String] = [
  "freed-runtime-observer": "runtime-observer",
  "freed-stability-controller": "stability-controller",
  "freed-scaffolding-maintainer": "scaffolding-writer",
  "freed-nightly-runner": "nightly-writer",
  "freed-release-verifier": "release-verifier",
]

private struct HostFailure: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

private struct ActorCancellation: Error {
  let signal: Int32
}

private struct ActorControlCancellation: Error {
  let signal: Int32
  let mutationMayHaveStarted: Bool
}

private final class ActorCancellationController {
  private var queueDescriptor: Int32 = -1
  private var handlersInstalled = false
  private var cancellationSignalsBlocked = false
  private var handoffCommitted = false
  private var firstObservedSignal: Int32?
  #if AUTOMATION_ACTOR_HOST_TESTING
    private var testingStateRoot: String?
  #endif

  init() throws {
    let descriptor = kqueue()
    guard descriptor >= 0 else {
      throw posixFailure("creating the actor cancellation queue")
    }
    var registrations = [
      kevent64_s(
        ident: UInt64(SIGINT),
        filter: Int16(EVFILT_SIGNAL),
        flags: UInt16(EV_ADD | EV_ENABLE),
        fflags: 0,
        data: 0,
        udata: 0,
        ext: (0, 0)
      ),
      kevent64_s(
        ident: UInt64(SIGTERM),
        filter: Int16(EVFILT_SIGNAL),
        flags: UInt16(EV_ADD | EV_ENABLE),
        fflags: 0,
        data: 0,
        udata: 0,
        ext: (0, 0)
      ),
    ]
    let registrationResult = registrations.withUnsafeMutableBufferPointer { buffer in
      kevent64(descriptor, buffer.baseAddress, Int32(buffer.count), nil, 0, 0, nil)
    }
    guard registrationResult == 0 else {
      close(descriptor)
      throw posixFailure("registering actor cancellation signals")
    }
    let previousInterruptHandler = Darwin.signal(SIGINT, SIG_IGN)
    guard !signalHandlerIsError(previousInterruptHandler) else {
      close(descriptor)
      throw posixFailure("installing actor interrupt ownership")
    }
    let terminateResult = Darwin.signal(SIGTERM, SIG_IGN)
    guard !signalHandlerIsError(terminateResult) else {
      _ = Darwin.signal(SIGINT, previousInterruptHandler)
      close(descriptor)
      throw posixFailure("installing actor termination ownership")
    }
    queueDescriptor = descriptor
    handlersInstalled = true
  }

  #if AUTOMATION_ACTOR_HOST_TESTING
    func setTestingStateRoot(_ stateRoot: String) {
      testingStateRoot = stateRoot
    }
  #endif

  func nextSignal(timeoutMilliseconds: Int = 0) throws -> Int32? {
    guard handlersInstalled else { return nil }
    let boundedTimeout = max(0, timeoutMilliseconds)
    var timeout = timespec(
      tv_sec: boundedTimeout / 1_000,
      tv_nsec: (boundedTimeout % 1_000) * 1_000_000
    )
    var event = kevent64_s()
    let result = kevent64(queueDescriptor, nil, 0, &event, 1, 0, &timeout)
    if result == 0 { return nil }
    if result < 0, errno == EINTR { return nil }
    if result < 0 {
      throw posixFailure("waiting for actor cancellation")
    }
    guard event.ident == UInt64(SIGINT) || event.ident == UInt64(SIGTERM) else {
      throw HostFailure("the actor host received an unexpected cancellation signal")
    }
    let signal = Int32(event.ident)
    if firstObservedSignal == nil { firstObservedSignal = signal }
    return signal
  }

  private func blockCancellationSignals() throws {
    guard !cancellationSignalsBlocked else { return }
    var blockedSignals = sigset_t()
    guard sigemptyset(&blockedSignals) == 0,
      sigaddset(&blockedSignals, SIGINT) == 0,
      sigaddset(&blockedSignals, SIGTERM) == 0
    else {
      throw posixFailure("blocking actor cancellation signals")
    }
    let blockResult = pthread_sigmask(SIG_BLOCK, &blockedSignals, nil)
    guard blockResult == 0 else {
      throw posixFailure("blocking actor cancellation signals", code: blockResult)
    }
    cancellationSignalsBlocked = true
  }

  private func drainCancellationSignals() throws {
    while let signal = try nextSignal() {
      if firstObservedSignal == nil { firstObservedSignal = signal }
    }
  }

  func beginHandoffCommit() throws -> Int32? {
    try blockCancellationSignals()
    try drainCancellationSignals()
    guard firstObservedSignal == nil else { return firstObservedSignal }
    handoffCommitted = true
    return nil
  }

  func finish(preferredSignal: Int32? = nil) throws -> Int32? {
    guard handlersInstalled else { return firstObservedSignal ?? preferredSignal }
    try blockCancellationSignals()
    if !handoffCommitted {
      try drainCancellationSignals()
      #if AUTOMATION_ACTOR_HOST_TESTING
        if let testingStateRoot {
          let pausePath = testingStateRoot + "/test-actor-finalization-pause"
          if FileManager.default.fileExists(atPath: pausePath) {
            FileManager.default.createFile(
              atPath: testingStateRoot + "/test-actor-finalization-drained",
              contents: Data()
            )
            usleep(1_000 * 1_000)
          }
      }
      #endif
      // This second drain is the terminal decision point. Signals stay blocked
      // through process exit and no handler restoration can reopen a gap.
      try drainCancellationSignals()
    }
    close(queueDescriptor)
    queueDescriptor = -1
    handlersInstalled = false
    if handoffCommitted { return nil }
    return firstObservedSignal ?? preferredSignal
  }
}

private func signalHandlerIsError(_ handler: sig_t?) -> Bool {
  unsafeBitCast(handler, to: Int.self) == unsafeBitCast(SIG_ERR, to: Int.self)
}

private enum HostMode {
  case attest
  case acquire
}

private struct ParsedArguments {
  let mode: HostMode
  let actor: String
  let stateRoot: String
  let leaseName: String
  let maximumLifetimeMilliseconds: Int
  let credentialSha256: String?
  let requestedKeychainService: String?
  let keychainAccount: String?
  #if AUTOMATION_ACTOR_HOST_TESTING
    let testBindingPath: String
    let testRuntimeRoot: String
    let testControlMode: String
    let testKeychainMode: String
  #endif
}

private struct LauncherBinding: Decodable {
  let schemaVersion: Int
  let actor: String
  let purpose: String
  let handoff: String
  let attestationProtocol: String
  let launcherPath: String
  let launcherSha256: String
  let stateRoot: String
  let leaseName: String
  let maxLeaseLifetimeMs: Int
  let keychainService: String
  let keychainAccount: String
  let nodePath: String
  let nodeSha256: String
  let controlEntryPath: String
  let controlEntrySha256: String
  let controlLibraryPath: String
  let controlLibrarySha256: String
  let kernelGuardContractPath: String
  let kernelGuardContractSha256: String
  let outcomeLedgerRepairContractPath: String
  let outcomeLedgerRepairContractSha256: String
  let leaseArchiveHelperPath: String
  let leaseArchiveHelperSha256: String
}

private struct ActorCredentialRecord: Decodable {
  let schemaVersion: Int
  let actor: String
  let purpose: String
  let tokenSha256: String
}

private struct ReadinessAttestation: Codable {
  let schemaVersion: Int
  let protocolName: String
  let purpose: String
  let actor: String
  let stateRoot: String
  let leaseName: String
  let maxLeaseLifetimeMs: Int
  let credentialSha256: String
  let handoff: String
  let keychainService: String
  let keychainAccount: String
  let credentialDigestVerified: Bool
  let canonicalLeaseReady: Bool
  let mutatesState: Bool

  enum CodingKeys: String, CodingKey {
    case schemaVersion
    case protocolName = "protocol"
    case purpose
    case actor
    case stateRoot
    case leaseName
    case maxLeaseLifetimeMs
    case credentialSha256
    case handoff
    case keychainService
    case keychainAccount
    case credentialDigestVerified
    case canonicalLeaseReady
    case mutatesState
  }
}

private struct ControlEnvelope: Decodable {
  let ok: Bool
  let schemaVersion: Int
  let action: String
  let stateRoot: String
  let result: ControlResult
}

private struct ControlResult: Decodable {
  let acquired: Bool
  let lease: ControlLease
}

private struct ControlLease: Decodable {
  let name: String
  let owner: String
  let token: String
  let credentialKind: String
  let acquiredAt: String
  let expiresAt: String
  let ttlMs: Int
}

private struct PublicControlLease: Decodable {
  let name: String
  let owner: String
}

private struct LeaseShowEnvelope: Decodable {
  let ok: Bool
  let schemaVersion: Int
  let action: String
  let stateRoot: String
  let result: PublicControlLease?
}

private struct LeaseReleaseResult: Decodable {
  let released: Bool
  let lease: PublicControlLease
}

private struct LeaseReleaseEnvelope: Decodable {
  let ok: Bool
  let schemaVersion: Int
  let action: String
  let stateRoot: String
  let result: LeaseReleaseResult
}

private struct LeaseHandoff: Codable {
  let schemaVersion: Int
  let actor: String
  let leaseName: String
  let leaseOperationId: String
  let leaseToken: String
  let leaseTokenSha256: String
  let acquiredAt: String
  let expiresAt: String
  let ttlMs: Int
}

private struct ControlInvocation {
  let executable: String
  let arguments: [String]
  let operationId: String?
  let leaseToken: String?
}

private struct LeaseOperationContext {
  let operationId: String
  let leaseToken: String
  let leaseTokenSha256: String
}

private protocol SecretReader {
  func readSecret(service: String, account: String) throws -> Data
}

private protocol KeychainInteractionController: AnyObject {
  func currentState() throws -> Bool
  func setAllowed(_ allowed: Bool) throws
}

private final class SystemKeychainInteractionController: KeychainInteractionController {
  func currentState() throws -> Bool {
    var state = DarwinBoolean(false)
    guard SecKeychainGetUserInteractionAllowed(&state) == errSecSuccess else {
      throw HostFailure("the Keychain interaction policy could not be read")
    }
    return state.boolValue
  }

  func setAllowed(_ allowed: Bool) throws {
    guard
      SecKeychainSetUserInteractionAllowed(allowed) == errSecSuccess
    else {
      throw HostFailure("the Keychain interaction policy could not be changed")
    }
  }
}

private struct KeychainSecretReader: SecretReader {
  func readSecret(service: String, account: String) throws -> Data {
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let secret = item as? Data else {
      throw HostFailure("the actor Keychain credential is unavailable without interaction")
    }
    return secret
  }
}

#if AUTOMATION_ACTOR_HOST_TESTING
  private final class FakeKeychainInteractionController: KeychainInteractionController {
    private let mode: String
    private(set) var interactionAllowed: Bool

    init(mode: String) {
      self.mode = mode
      interactionAllowed = mode != "initially-disabled"
    }

    func currentState() throws -> Bool {
      if mode == "get-failure" {
        throw HostFailure("the test Keychain interaction policy could not be read")
      }
      return interactionAllowed
    }

    func setAllowed(_ allowed: Bool) throws {
      if !allowed, mode == "disable-failure" {
        throw HostFailure("the test Keychain interaction policy could not be disabled")
      }
      if !allowed, mode == "disable-noop" {
        return
      }
      if allowed, mode == "restore-failure" {
        throw HostFailure("the test Keychain interaction policy could not be restored")
      }
      interactionAllowed = allowed
    }
  }

  private struct FakeSecretReader: SecretReader {
    let interactionController: FakeKeychainInteractionController
    let mode: String

    func readSecret(service: String, account: String) throws -> Data {
      guard service == keychainService, actorLeaseNames[account] != nil else {
        throw HostFailure("the test Keychain request did not match the actor binding")
      }
      guard !interactionController.interactionAllowed else {
        throw HostFailure("the test Keychain credential read permitted user interaction")
      }
      if mode == "read-failure" {
        throw HostFailure("the test Keychain credential could not be read")
      }
      if mode == "delayed" {
        usleep(testKeychainDelayMicroseconds)
      }
      if mode == "acquisition-window-exhausted" {
        usleep(testExhaustedKeychainDelayMicroseconds)
      }
      return fakeCredential
    }
  }
#endif

private func readSecretWithoutInteraction(
  reader: SecretReader,
  interactionController: KeychainInteractionController,
  service: String,
  account: String
) throws -> Data {
  let previousInteractionState = try interactionController.currentState()
  try interactionController.setAllowed(false)
  guard try interactionController.currentState() == false else {
    throw HostFailure("the Keychain interaction policy remained enabled after the disable request")
  }

  var secret: Data?
  var readFailure: Error?
  do {
    secret = try reader.readSecret(service: service, account: account)
  } catch {
    readFailure = error
  }

  do {
    try interactionController.setAllowed(previousInteractionState)
    guard try interactionController.currentState() == previousInteractionState else {
      throw HostFailure("the Keychain interaction policy restored an unexpected state")
    }
  } catch {
    if let secretCount = secret?.count {
      secret?.resetBytes(in: 0..<secretCount)
    }
    throw HostFailure(
      "the Keychain interaction policy could not be restored after the credential read"
    )
  }
  if let readFailure {
    throw readFailure
  }
  guard let secret else {
    throw HostFailure("the actor Keychain credential read returned no data")
  }
  return secret
}

private protocol ControlInvoker {
  func run(
    _ invocation: ControlInvocation,
    binding: LauncherBinding,
    persistentCredential: Data?,
    lifecycleDeadlineMilliseconds: UInt64,
    cancellationController: ActorCancellationController?
  ) throws -> Data
}

private struct ProcessControlInvoker: ControlInvoker {
  let timeoutMilliseconds: UInt64

  init(timeoutMilliseconds: UInt64 = controlTimeoutMilliseconds) {
    self.timeoutMilliseconds = timeoutMilliseconds
  }

  func run(
    _ invocation: ControlInvocation,
    binding: LauncherBinding,
    persistentCredential: Data?,
    lifecycleDeadlineMilliseconds: UInt64,
    cancellationController: ActorCancellationController?
  ) throws -> Data {
    try runBoundedControlProcess(
      invocation,
      persistentCredential: persistentCredential,
      timeoutMilliseconds: timeoutMilliseconds,
      lifecycleDeadlineMilliseconds: lifecycleDeadlineMilliseconds,
      cancellationController: cancellationController
    )
  }
}

#if AUTOMATION_ACTOR_HOST_TESTING
  private final class FakeControlInvoker: ControlInvoker {
    let mode: String
    private var acquireAttempts = 0
    private var releaseAttempts = 0
    private var showAttempts = 0
    private var leaseActive = false
    private var acquireOperationId: String?
    private var acquireToken: String?
    private var releaseOperationId: String?
    private var releaseToken: String?

    init(mode: String) {
      self.mode = mode
    }

    func run(
      _ invocation: ControlInvocation,
      binding: LauncherBinding,
      persistentCredential: Data?,
      lifecycleDeadlineMilliseconds: UInt64,
      cancellationController: ActorCancellationController?
    ) throws -> Data {
      if let signal = try cancellationController?.nextSignal() {
        throw ActorControlCancellation(signal: signal, mutationMayHaveStarted: false)
      }
      let action = invocation.arguments.count > 2 ? invocation.arguments[2] : ""
      let auditRecord: [String: Any] = [
        "action": action,
        "operationId": invocation.operationId ?? NSNull(),
        "leaseTokenSha256": invocation.leaseToken.map { sha256Hex(Data($0.utf8)) } ?? NSNull(),
        "persistentCredentialPresent": persistentCredential != nil,
      ]
      if let auditBytes = try? JSONSerialization.data(withJSONObject: auditRecord) {
        let auditPath = binding.stateRoot + "/test-actor-control.jsonl"
        if !FileManager.default.fileExists(atPath: auditPath) {
          FileManager.default.createFile(atPath: auditPath, contents: Data())
        }
        if let handle = FileHandle(forWritingAtPath: auditPath) {
          defer { handle.closeFile() }
          handle.seekToEndOfFile()
          handle.write(auditBytes + Data([0x0a]))
        }
      }
      let expectedCredential = action == "acquire" ? fakeCredential : nil
      guard invocation.executable == binding.nodePath,
        persistentCredential == expectedCredential,
        inheritedEnvironmentNames().isEmpty,
        try monotonicMilliseconds() < lifecycleDeadlineMilliseconds
      else {
        throw HostFailure("the test control invocation was not canonical or scrubbed")
      }
      if action == "show" {
        showAttempts += 1
        guard invocation.operationId == nil, invocation.leaseToken == nil else {
          throw HostFailure("the test lease inspection received secret mutation state")
        }
        if mode == "malformed-acquire-and-show", showAttempts == 1 {
          guard releaseAttempts == 2 else {
            throw HostFailure("the test cleanup inspected before exact release retry")
          }
          return Data("{}".utf8)
        }
        let payload: [String: Any] = [
          "ok": true,
          "schemaVersion": 1,
          "action": "lease.show",
          "stateRoot": binding.stateRoot,
          "result": leaseActive
            ? ["name": binding.leaseName, "owner": binding.actor, "status": "active"]
            : NSNull(),
        ]
        return try JSONSerialization.data(withJSONObject: payload)
      }
      guard let operationId = invocation.operationId,
        let requestedToken = invocation.leaseToken,
        validLeaseOperationId(operationId),
        requestedToken.utf8.count >= 32,
        requestedToken.utf8.count <= 4 * 1_024
      else {
        throw HostFailure("the test lease mutation did not retain its caller secrets")
      }
      if action == "release" {
        if let firstOperationId = releaseOperationId, let firstToken = releaseToken {
          guard operationId == firstOperationId, requestedToken == firstToken else {
            throw HostFailure("the test release retry changed its caller-owned identity")
          }
        } else {
          releaseOperationId = operationId
          releaseToken = requestedToken
        }
        releaseAttempts += 1
        let wasActive = leaseActive
        leaseActive = false
        if mode == "malformed-acquire-and-show", releaseAttempts == 1 {
          return Data("{}".utf8)
        }
        let payload: [String: Any] = [
          "ok": true,
          "schemaVersion": 1,
          "action": "lease.release",
          "stateRoot": binding.stateRoot,
          "result": [
            "released": wasActive,
            "lease": ["name": binding.leaseName, "owner": binding.actor],
          ],
        ]
        return try JSONSerialization.data(withJSONObject: payload)
      }
      let expectedArguments = [
        binding.controlEntryPath,
        "lease", "acquire",
        "--state-root", binding.stateRoot,
        "--name", binding.leaseName,
        "--owner", binding.actor,
        "--ttl-seconds", String(leaseLifetimeSeconds),
      ]
      guard action == "acquire", invocation.arguments == expectedArguments else {
        throw HostFailure("the test control invocation was not canonical or scrubbed")
      }
      if let firstOperationId = acquireOperationId, let firstToken = acquireToken {
        guard operationId == firstOperationId, requestedToken == firstToken else {
          throw HostFailure("the test acquire retry changed its caller-owned identity")
        }
      } else {
        acquireOperationId = operationId
        acquireToken = requestedToken
      }
      acquireAttempts += 1
      leaseActive = true
      if mode == "oversized" {
        return Data(repeating: 0x61, count: maximumControlOutputBytes + 1)
      }
      if mode == "response-loss-once", acquireAttempts == 1 {
        return Data("{}".utf8)
      }
      if mode == "commit-response-loss-near-deadline" {
        let now = try monotonicMilliseconds()
        if now < lifecycleDeadlineMilliseconds {
          let remainingMilliseconds = lifecycleDeadlineMilliseconds - now
          usleep(useconds_t((remainingMilliseconds + 50) * 1_000))
        }
        return Data("{}".utf8)
      }
      if mode == "malformed-acquire-and-show" {
        return Data("{}".utf8)
      }
      let acquiredAt = "2026-07-13T12:00:00.000Z"
      let expiresAt =
        mode == "overlong"
        ? "2026-07-13T12:30:00.001Z"
        : "2026-07-13T12:30:00.000Z"
      let token = mode == "short-token" ? "short" : requestedToken
      let payload: [String: Any] = [
        "ok": true,
        "schemaVersion": 1,
        "action": "lease.acquire",
        "stateRoot": binding.stateRoot,
        "result": [
          "acquired": true,
          "lease": [
            "name": binding.leaseName,
            "owner": binding.actor,
            "token": token,
            "credentialKind": "persistent-actor",
            "acquiredAt": acquiredAt,
            "expiresAt": expiresAt,
            "ttlMs": leaseLifetimeMilliseconds,
          ],
        ],
      ]
      return try JSONSerialization.data(withJSONObject: payload)
    }
  }
#endif

private struct CStringArena {
  private(set) var pointers: [UnsafeMutablePointer<CChar>] = []
  private(set) var lengths: [Int] = []

  mutating func append(_ string: String) throws -> UnsafeMutablePointer<CChar> {
    try append(Data(string.utf8))
  }

  mutating func append(_ data: Data) throws -> UnsafeMutablePointer<CChar> {
    guard !data.contains(0) else {
      throw HostFailure("a control process value contains a null byte")
    }
    let pointer = UnsafeMutablePointer<CChar>.allocate(capacity: data.count + 1)
    data.withUnsafeBytes { rawBuffer in
      if let baseAddress = rawBuffer.baseAddress {
        memcpy(pointer, baseAddress, data.count)
      }
    }
    pointer[data.count] = 0
    pointers.append(pointer)
    lengths.append(data.count + 1)
    return pointer
  }

  mutating func destroy() {
    for (pointer, length) in zip(pointers, lengths) {
      memset_s(pointer, length, 0, length)
      pointer.deallocate()
    }
    pointers.removeAll(keepingCapacity: false)
    lengths.removeAll(keepingCapacity: false)
  }
}

private func monotonicMilliseconds() throws -> UInt64 {
  var value = timespec()
  guard clock_gettime(CLOCK_MONOTONIC, &value) == 0 else {
    throw posixFailure("reading the control process clock")
  }
  return UInt64(value.tv_sec) * 1_000 + UInt64(value.tv_nsec) / 1_000_000
}

private func waitForChild(_ child: pid_t) throws -> Int32 {
  var status: Int32 = 0
  while waitpid(child, &status, 0) < 0 {
    if errno == EINTR { continue }
    throw posixFailure("waiting for the pinned automation control process")
  }
  return status
}

private func terminateChild(_ child: pid_t) {
  guard child > 0 else { return }
  _ = kill(-child, SIGKILL)
  _ = kill(child, SIGKILL)
  var status: Int32 = 0
  while waitpid(child, &status, 0) < 0, errno == EINTR {}
}

private func runBoundedControlProcess(
  _ invocation: ControlInvocation,
  persistentCredential: Data?,
  timeoutMilliseconds: UInt64,
  lifecycleDeadlineMilliseconds: UInt64,
  cancellationController: ActorCancellationController?
) throws -> Data {
  var argumentArena = CStringArena()
  var environmentArena = CStringArena()
  defer {
    argumentArena.destroy()
    environmentArena.destroy()
  }
  var arguments: [UnsafeMutablePointer<CChar>?] = []
  arguments.append(try argumentArena.append(invocation.executable))
  for argument in invocation.arguments {
    arguments.append(try argumentArena.append(argument))
  }
  arguments.append(nil)

  var credentialEnvironment = Data()
  if let persistentCredential {
    credentialEnvironment.append(Data("FREED_AUTOMATION_ACTOR_TOKEN=".utf8))
    credentialEnvironment.append(persistentCredential)
  }
  defer { credentialEnvironment.resetBytes(in: 0..<credentialEnvironment.count) }
  guard (invocation.operationId == nil) == (invocation.leaseToken == nil) else {
    throw HostFailure("the control process lease handoff is incomplete")
  }
  var environment: [UnsafeMutablePointer<CChar>?] = []
  if !credentialEnvironment.isEmpty {
    environment.append(try environmentArena.append(credentialEnvironment))
  }
  if let operationId = invocation.operationId, let leaseToken = invocation.leaseToken {
    environment.append(
      try environmentArena.append("FREED_AUTOMATION_LEASE_OPERATION_ID=\(operationId)"))
    environment.append(try environmentArena.append("FREED_AUTOMATION_LEASE_TOKEN=\(leaseToken)"))
  }
  environment.append(try environmentArena.append("LANG=C"))
  environment.append(try environmentArena.append("LC_ALL=C"))
  environment.append(try environmentArena.append("PATH=/usr/bin:/bin"))
  environment.append(nil)

  var descriptors = [Int32](repeating: -1, count: 2)
  guard pipe(&descriptors) == 0 else {
    throw posixFailure("creating the control process output pipe")
  }
  let readDescriptor = descriptors[0]
  var writeDescriptor = descriptors[1]
  let nullDescriptor = open("/dev/null", O_RDONLY | O_CLOEXEC)
  guard nullDescriptor >= 0 else {
    close(readDescriptor)
    close(writeDescriptor)
    throw posixFailure("opening null input for the control process")
  }
  var child = pid_t()
  var childStarted = false
  var childWaited = false
  defer {
    close(readDescriptor)
    if writeDescriptor >= 0 { close(writeDescriptor) }
    close(nullDescriptor)
    if childStarted && !childWaited { terminateChild(child) }
  }

  var fileActions: posix_spawn_file_actions_t? = nil
  var attributes: posix_spawnattr_t? = nil
  guard posix_spawn_file_actions_init(&fileActions) == 0 else {
    throw HostFailure("control process file actions could not be initialized")
  }
  defer { posix_spawn_file_actions_destroy(&fileActions) }
  guard posix_spawn_file_actions_adddup2(&fileActions, nullDescriptor, STDIN_FILENO) == 0,
    posix_spawn_file_actions_adddup2(&fileActions, writeDescriptor, STDOUT_FILENO) == 0,
    posix_spawn_file_actions_adddup2(&fileActions, writeDescriptor, STDERR_FILENO) == 0,
    addRootDirectoryAction(&fileActions) == 0,
    posix_spawn_file_actions_addclose(&fileActions, readDescriptor) == 0,
    posix_spawn_file_actions_addclose(&fileActions, writeDescriptor) == 0,
    posix_spawn_file_actions_addclose(&fileActions, nullDescriptor) == 0
  else {
    throw HostFailure("control process standard streams could not be isolated")
  }
  guard posix_spawnattr_init(&attributes) == 0 else {
    throw HostFailure("control process attributes could not be initialized")
  }
  defer { posix_spawnattr_destroy(&attributes) }
  var childSignalMask = sigset_t()
  var childDefaultSignals = sigset_t()
  guard sigemptyset(&childSignalMask) == 0,
    sigemptyset(&childDefaultSignals) == 0,
    sigaddset(&childDefaultSignals, SIGINT) == 0,
    sigaddset(&childDefaultSignals, SIGTERM) == 0
  else {
    throw posixFailure("preparing control process signals")
  }
  let spawnFlags = Int16(
    POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGMASK
      | POSIX_SPAWN_SETSIGDEF
  )
  guard posix_spawnattr_setpgroup(&attributes, 0) == 0,
    posix_spawnattr_setsigmask(&attributes, &childSignalMask) == 0,
    posix_spawnattr_setsigdefault(&attributes, &childDefaultSignals) == 0,
    posix_spawnattr_setflags(&attributes, spawnFlags) == 0
  else {
    throw HostFailure("control process descriptor isolation could not be enabled")
  }

  if let signal = try cancellationController?.nextSignal() {
    throw ActorControlCancellation(signal: signal, mutationMayHaveStarted: false)
  }

  let spawnResult = arguments.withUnsafeMutableBufferPointer { argumentBuffer in
    environment.withUnsafeMutableBufferPointer { environmentBuffer in
      invocation.executable.withCString { executable in
        posix_spawn(
          &child,
          executable,
          &fileActions,
          &attributes,
          argumentBuffer.baseAddress!,
          environmentBuffer.baseAddress!
        )
      }
    }
  }
  environmentArena.destroy()
  credentialEnvironment.resetBytes(in: 0..<credentialEnvironment.count)
  guard spawnResult == 0 else {
    throw posixFailure("starting the pinned automation control process", code: spawnResult)
  }
  childStarted = true
  close(writeDescriptor)
  writeDescriptor = -1
  guard fcntl(readDescriptor, F_SETFL, O_NONBLOCK) == 0 else {
    throw posixFailure("configuring bounded control process output")
  }

  let startedAt = try monotonicMilliseconds()
  guard startedAt < lifecycleDeadlineMilliseconds else {
    terminateChild(child)
    childWaited = true
    throw HostFailure("the native actor lifecycle budget was exhausted")
  }
  let deadline = min(
    startedAt + timeoutMilliseconds,
    lifecycleDeadlineMilliseconds
  )
  var output = Data()
  var childStatus: Int32?
  var reachedEnd = false
  var buffer = [UInt8](repeating: 0, count: 4 * 1_024)
  defer { buffer.resetBytes(in: 0..<buffer.count) }
  while childStatus == nil || !reachedEnd {
    if let signal = try cancellationController?.nextSignal() {
      terminateChild(child)
      childWaited = true
      throw ActorControlCancellation(signal: signal, mutationMayHaveStarted: true)
    }
    if try monotonicMilliseconds() >= deadline {
      terminateChild(child)
      childWaited = true
      throw HostFailure("the pinned automation control process timed out")
    }
    var descriptor = pollfd(fd: readDescriptor, events: Int16(POLLIN | POLLHUP), revents: 0)
    let pollResult = poll(&descriptor, 1, 100)
    if pollResult < 0, errno != EINTR {
      throw posixFailure("polling bounded control process output")
    }
    if pollResult > 0 {
      while true {
        let count = read(readDescriptor, &buffer, buffer.count)
        if count > 0 {
          guard output.count + count <= maximumControlOutputBytes else {
            terminateChild(child)
            childWaited = true
            throw HostFailure("the pinned automation control process returned too much output")
          }
          output.append(buffer, count: count)
          continue
        }
        if count == 0 {
          reachedEnd = true
        } else if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR {
          throw posixFailure("reading bounded control process output")
        }
        break
      }
    }
    if childStatus == nil {
      var status: Int32 = 0
      let result = waitpid(child, &status, WNOHANG)
      if result == child {
        childStatus = status
        childWaited = true
      } else if result < 0, errno != EINTR {
        throw posixFailure("checking the pinned automation control process")
      }
    }
  }
  let status: Int32
  if let childStatus {
    status = childStatus
  } else {
    status = try waitForChild(child)
  }
  childWaited = true
  if let signal = try cancellationController?.nextSignal() {
    throw ActorControlCancellation(signal: signal, mutationMayHaveStarted: true)
  }
  let terminationSignal = status & 0x7f
  guard terminationSignal == 0, ((status >> 8) & 0xff) == 0 else {
    throw HostFailure("the pinned automation control process rejected the lease request")
  }
  return output
}

private func addRootDirectoryAction(
  _ fileActions: inout posix_spawn_file_actions_t?
) -> Int32 {
  return posix_spawn_file_actions_addchdir_np(&fileActions, "/")
}

private func posixFailure(_ operation: String, code: Int32 = errno) -> HostFailure {
  HostFailure("\(operation) failed with errno \(code)")
}

private func disableCoreDumps() throws {
  var limit = rlimit(rlim_cur: 0, rlim_max: 0)
  guard setrlimit(RLIMIT_CORE, &limit) == 0 else {
    throw posixFailure("disabling actor host core dumps")
  }
}

private func inheritedEnvironmentNames() -> [String] {
  var names: [String] = []
  var cursor = environ
  while let entry = cursor.pointee {
    let value = String(cString: entry)
    if let separator = value.firstIndex(of: "=") {
      names.append(String(value[..<separator]))
    }
    cursor = cursor.advanced(by: 1)
  }
  return names
}

private func clearInheritedEnvironment() throws {
  for name in inheritedEnvironmentNames() where !name.isEmpty {
    guard unsetenv(name) == 0 else {
      throw posixFailure("clearing inherited actor host state")
    }
  }
  guard inheritedEnvironmentNames().isEmpty else {
    throw HostFailure("the inherited actor host environment could not be cleared")
  }
}

private func requireLowercaseHex(_ value: String, length: Int, label: String) throws {
  let bytes = Array(value.utf8)
  guard bytes.count == length,
    bytes.allSatisfy({ byte in
      (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
    })
  else {
    throw HostFailure("\(label) must contain \(length) lowercase hexadecimal characters")
  }
}

private func validLeaseOperationId(_ value: String) -> Bool {
  value.range(
    of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    options: .regularExpression
  ) != nil
}

private func newLeaseOperationContext() throws -> LeaseOperationContext {
  let operationId = try newLeaseOperationId()
  var bytes = [UInt8](repeating: 0, count: 32)
  guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
    throw HostFailure("the caller-retained lease token could not be generated")
  }
  defer { bytes.resetBytes(in: 0..<bytes.count) }
  let token = Data(bytes).base64EncodedString()
  return LeaseOperationContext(
    operationId: operationId,
    leaseToken: token,
    leaseTokenSha256: sha256Hex(Data(token.utf8))
  )
}

private func newLeaseOperationId() throws -> String {
  let operationId = UUID().uuidString.lowercased()
  guard validLeaseOperationId(operationId) else {
    throw HostFailure("the lease operation identity could not be generated")
  }
  return operationId
}

private func parseArguments(_ values: [String]) throws -> ParsedArguments {
  var mode: HostMode?
  var options: [String: String] = [:]
  var index = 0
  while index < values.count {
    let value = values[index]
    if value == "--attest-readiness" || value == "--acquire-lease" {
      guard mode == nil else {
        throw HostFailure("exactly one actor host mode is required")
      }
      mode = value == "--attest-readiness" ? .attest : .acquire
      index += 1
      continue
    }
    var allowed = Set([
      "--protocol", "--actor", "--state-root", "--lease-name",
      "--max-lifetime-ms", "--credential-sha256", "--keychain-service",
      "--keychain-account", "--ttl-seconds",
    ])
    #if AUTOMATION_ACTOR_HOST_TESTING
      allowed.insert("--test-binding")
      allowed.insert("--test-runtime-root")
      allowed.insert("--test-control-mode")
      allowed.insert("--test-keychain-mode")
    #endif
    guard allowed.contains(value), index + 1 < values.count,
      options[value] == nil
    else {
      throw HostFailure("the actor host received an unsupported or duplicate argument")
    }
    options[value] = values[index + 1]
    index += 2
  }
  guard let mode,
    let actor = options["--actor"],
    let stateRoot = options["--state-root"],
    let leaseName = options["--lease-name"]
  else {
    throw HostFailure("the actor host request is incomplete")
  }
  guard let canonicalLeaseName = actorLeaseNames[actor] else {
    throw HostFailure("the requested identity is not a general automation actor")
  }
  guard leaseName == canonicalLeaseName else {
    throw HostFailure("the requested actor lease name is not canonical")
  }

  let attestationOnly = [
    "--protocol", "--max-lifetime-ms", "--credential-sha256",
    "--keychain-service", "--keychain-account",
  ]
  let acquisitionOnly = ["--ttl-seconds"]
  let maximumLifetimeMilliseconds: Int
  let credentialSha256: String?
  let requestedKeychainService: String?
  let keychainAccount: String?
  switch mode {
  case .attest:
    guard acquisitionOnly.allSatisfy({ options[$0] == nil }),
      options["--protocol"] == attestationProtocol,
      options["--max-lifetime-ms"] == String(leaseLifetimeMilliseconds),
      let digest = options["--credential-sha256"],
      options["--keychain-service"] == keychainService,
      options["--keychain-account"] == actor
    else {
      throw HostFailure("the actor readiness attestation request is invalid")
    }
    try requireLowercaseHex(digest, length: 64, label: "credential digest")
    maximumLifetimeMilliseconds = leaseLifetimeMilliseconds
    credentialSha256 = digest
    requestedKeychainService = keychainService
    keychainAccount = actor
  case .acquire:
    guard attestationOnly.allSatisfy({ options[$0] == nil }),
      options["--ttl-seconds"] == String(leaseLifetimeSeconds)
    else {
      throw HostFailure("the actor lease request must use exactly 1,800 seconds")
    }
    maximumLifetimeMilliseconds = leaseLifetimeMilliseconds
    credentialSha256 = nil
    requestedKeychainService = nil
    keychainAccount = nil
  }

  #if AUTOMATION_ACTOR_HOST_TESTING
    guard let testBindingPath = options["--test-binding"],
      let testRuntimeRoot = options["--test-runtime-root"]
    else {
      throw HostFailure("the actor host test binding is required in test builds")
    }
    let testControlMode = options["--test-control-mode"] ?? "valid"
    guard
      [
        "valid", "oversized", "short-token", "overlong", "response-loss-once",
        "commit-response-loss-near-deadline", "malformed-acquire-and-show", "process-timeout",
        "post-child-handoff-delay", "process-signal-state",
        "process-cancellation-commit", "process-cleanup-cancellation",
        "post-final-check-pre-write-delay",
      ].contains(testControlMode)
    else {
      throw HostFailure("the actor host test control mode is invalid")
    }
    let testKeychainMode = options["--test-keychain-mode"] ?? "valid"
    guard
      [
        "valid", "read-failure", "get-failure", "disable-failure", "disable-noop",
        "restore-failure", "initially-disabled", "delayed", "acquisition-window-exhausted",
        "signal-preflight-delay",
      ].contains(testKeychainMode)
    else {
      throw HostFailure("the actor host test Keychain mode is invalid")
    }
    return ParsedArguments(
      mode: mode,
      actor: actor,
      stateRoot: stateRoot,
      leaseName: leaseName,
      maximumLifetimeMilliseconds: maximumLifetimeMilliseconds,
      credentialSha256: credentialSha256,
      requestedKeychainService: requestedKeychainService,
      keychainAccount: keychainAccount,
      testBindingPath: testBindingPath,
      testRuntimeRoot: testRuntimeRoot,
      testControlMode: testControlMode,
      testKeychainMode: testKeychainMode
    )
  #else
    return ParsedArguments(
      mode: mode,
      actor: actor,
      stateRoot: stateRoot,
      leaseName: leaseName,
      maximumLifetimeMilliseconds: maximumLifetimeMilliseconds,
      credentialSha256: credentialSha256,
      requestedKeychainService: requestedKeychainService,
      keychainAccount: keychainAccount
    )
  #endif
}

private func canonicalExistingPath(_ path: String, label: String) throws -> String {
  guard path.first == "/", !path.contains("\n"), !path.contains("\0") else {
    throw HostFailure("\(label) must be an absolute path without control characters")
  }
  guard let pointer = realpath(path, nil) else {
    throw HostFailure("\(label) cannot be resolved")
  }
  defer { free(pointer) }
  let resolved = String(cString: pointer)
  guard resolved == path else {
    throw HostFailure("\(label) must already be a physical canonical path")
  }
  return resolved
}

private func currentExecutablePath() throws -> String {
  var size: UInt32 = 0
  _ = _NSGetExecutablePath(nil, &size)
  var buffer = [CChar](repeating: 0, count: Int(size))
  guard _NSGetExecutablePath(&buffer, &size) == 0 else {
    throw HostFailure("the actor host executable path is unavailable")
  }
  return try canonicalExistingPath(String(cString: buffer), label: "actor host executable")
}

private func metadata(_ path: String) throws -> stat {
  var value = stat()
  guard lstat(path, &value) == 0 else {
    throw HostFailure("a trusted actor host path is unavailable")
  }
  return value
}

private func trustedOwners() -> Set<uid_t> {
  #if AUTOMATION_ACTOR_HOST_TESTING
    return [0, getuid()]
  #else
    return [0]
  #endif
}

private func requireTrustedHierarchy(_ path: String, label: String) throws {
  let canonical = try canonicalExistingPath(path, label: label)
  var current = "/"
  for component in URL(fileURLWithPath: canonical).pathComponents where component != "/" {
    current = URL(fileURLWithPath: current).appendingPathComponent(component).path
    let value = try metadata(current)
    guard value.st_mode & S_IFMT == S_IFDIR, trustedOwners().contains(value.st_uid),
      value.st_mode & 0o022 == 0
    else {
      throw HostFailure("\(label) must have a trusted immutable physical directory hierarchy")
    }
  }
}

private func requireTrustedFile(_ path: String, executable: Bool, label: String) throws {
  _ = try canonicalExistingPath(path, label: label)
  let value = try metadata(path)
  guard value.st_mode & S_IFMT == S_IFREG, trustedOwners().contains(value.st_uid),
    value.st_mode & 0o7000 == 0,
    value.st_mode & 0o022 == 0,
    !executable || value.st_mode & 0o111 != 0
  else {
    throw HostFailure("\(label) must be a trusted immutable regular file")
  }
  try requireTrustedHierarchy(URL(fileURLWithPath: path).deletingLastPathComponent().path, label: label)
}

private func requireOwnerDirectory(_ path: String, label: String) throws {
  _ = try canonicalExistingPath(path, label: label)
  let value = try metadata(path)
  guard value.st_mode & S_IFMT == S_IFDIR, value.st_uid == getuid(),
    value.st_mode & 0o077 == 0
  else {
    throw HostFailure("\(label) must be a private physical directory owned by the current user")
  }
}

private func isStrictChild(_ path: String, of root: String) -> Bool {
  path.hasPrefix(root + "/") && path.count > root.count + 1
}

private func readSecureFile(
  _ path: String,
  maximumBytes: Int,
  allowedOwners: Set<uid_t>,
  requiredMode: mode_t? = nil
) throws -> Data {
  _ = try canonicalExistingPath(path, label: "actor host file")
  let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw HostFailure("an actor host file cannot be opened")
  }
  defer { close(descriptor) }
  var value = stat()
  guard fstat(descriptor, &value) == 0,
    value.st_mode & S_IFMT == S_IFREG,
    allowedOwners.contains(value.st_uid),
    value.st_size >= 0,
    value.st_size <= maximumBytes
  else {
    throw HostFailure("an actor host file has an invalid owner, type, or size")
  }
  if let requiredMode {
    guard value.st_mode & 0o777 == requiredMode else {
      throw HostFailure("an actor host file has invalid permissions")
    }
  } else if value.st_mode & 0o022 != 0 {
    throw HostFailure("an actor host file is group or world writable")
  }
  var data = Data()
  var buffer = [UInt8](repeating: 0, count: min(maximumBytes + 1, 16 * 1_024))
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count == 0 { break }
    if count < 0 {
      if errno == EINTR { continue }
      throw posixFailure("reading an actor host file")
    }
    guard data.count + count <= maximumBytes else {
      throw HostFailure("an actor host file exceeds its size limit")
    }
    data.append(buffer, count: count)
  }
  buffer.resetBytes(in: 0..<buffer.count)
  return data
}

private func sha256Hex(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func runtimeDigest(_ binding: LauncherBinding) -> String {
  let manifest =
    "freed-automation-actor-runtime-v3\n" +
    "node:\(binding.nodeSha256)\n" +
    "automation-control.mjs:\(binding.controlEntrySha256)\n" +
    "lib/automation-control.mjs:\(binding.controlLibrarySha256)\n" +
    "lib/automation-kernel-guard-contract.mjs:\(binding.kernelGuardContractSha256)\n" +
    "lib/outcome-ledger-repair-contract.mjs:\(binding.outcomeLedgerRepairContractSha256)\n" +
    "lib/lease-archive-move.py:\(binding.leaseArchiveHelperSha256)\n"
  return sha256Hex(Data(manifest.utf8))
}

private func sha256ForFile(_ path: String) throws -> String {
  let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw HostFailure("a pinned actor host file cannot be opened")
  }
  defer { close(descriptor) }
  var digest = SHA256()
  var buffer = [UInt8](repeating: 0, count: 1_024 * 1_024)
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count == 0 { break }
    if count < 0 {
      if errno == EINTR { continue }
      throw posixFailure("hashing a pinned actor host file")
    }
    digest.update(data: Data(buffer[0..<count]))
  }
  buffer.resetBytes(in: 0..<buffer.count)
  return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func decodeStrict<T: Decodable>(
  _ type: T.Type,
  data: Data,
  expectedKeys: Set<String>,
  label: String
) throws -> T {
  let value = try JSONSerialization.jsonObject(with: data)
  guard let dictionary = value as? [String: Any], Set(dictionary.keys) == expectedKeys else {
    throw HostFailure("\(label) has an unsupported shape")
  }
  do {
    return try JSONDecoder().decode(type, from: data)
  } catch {
    throw HostFailure("\(label) is not valid JSON")
  }
}

private func bindingPath(_ arguments: ParsedArguments) -> String {
  #if AUTOMATION_ACTOR_HOST_TESTING
    return arguments.testBindingPath
  #else
    return productionBindingRoot + "/" + arguments.actor + ".json"
  #endif
}

private func runtimeRoot(_ arguments: ParsedArguments) -> String {
  #if AUTOMATION_ACTOR_HOST_TESTING
    return arguments.testRuntimeRoot
  #else
    return productionRuntimeRoot
  #endif
}

private func loadAndValidateBinding(_ arguments: ParsedArguments) throws -> LauncherBinding {
  let path = bindingPath(arguments)
  let canonicalBindingRoot = URL(fileURLWithPath: path).deletingLastPathComponent().path
  guard path == canonicalBindingRoot + "/" + arguments.actor + ".json" else {
    throw HostFailure("the actor launcher binding path is not canonical")
  }
  #if !AUTOMATION_ACTOR_HOST_TESTING
    guard canonicalBindingRoot == productionBindingRoot else {
      throw HostFailure("the actor launcher binding root is not canonical")
    }
  #endif
  try requireTrustedFile(path, executable: false, label: "actor launcher binding")
  let data = try readSecureFile(
    path,
    maximumBytes: maximumBindingBytes,
    allowedOwners: trustedOwners()
  )
  let binding = try decodeStrict(
    LauncherBinding.self,
    data: data,
    expectedKeys: [
      "schemaVersion", "actor", "purpose", "handoff", "attestationProtocol",
      "launcherPath", "launcherSha256", "stateRoot", "leaseName",
      "maxLeaseLifetimeMs", "keychainService", "keychainAccount", "nodePath",
      "nodeSha256", "controlEntryPath", "controlEntrySha256",
      "controlLibraryPath", "controlLibrarySha256",
      "kernelGuardContractPath", "kernelGuardContractSha256",
      "outcomeLedgerRepairContractPath", "outcomeLedgerRepairContractSha256",
      "leaseArchiveHelperPath", "leaseArchiveHelperSha256",
    ],
    label: "actor launcher binding"
  )
  guard binding.schemaVersion == bindingSchemaVersion,
    binding.actor == arguments.actor,
    binding.purpose == bindingPurpose,
    binding.handoff == bindingHandoff,
    binding.attestationProtocol == attestationProtocol,
    binding.stateRoot == arguments.stateRoot,
    binding.leaseName == arguments.leaseName,
    binding.maxLeaseLifetimeMs == arguments.maximumLifetimeMilliseconds,
    binding.keychainService == keychainService,
    binding.keychainAccount == arguments.actor
  else {
    throw HostFailure("the actor launcher binding does not match this request")
  }
  try requireLowercaseHex(binding.launcherSha256, length: 64, label: "launcher digest")
  try requireLowercaseHex(binding.nodeSha256, length: 64, label: "Node digest")
  try requireLowercaseHex(binding.controlEntrySha256, length: 64, label: "control entry digest")
  try requireLowercaseHex(binding.controlLibrarySha256, length: 64, label: "control library digest")
  try requireLowercaseHex(binding.kernelGuardContractSha256, length: 64, label: "kernel guard contract digest")
  try requireLowercaseHex(binding.outcomeLedgerRepairContractSha256, length: 64, label: "outcome ledger repair contract digest")
  try requireLowercaseHex(binding.leaseArchiveHelperSha256, length: 64, label: "lease archive helper digest")

  let expectedLauncherPath =
    canonicalBindingRoot + "/bin/" + binding.actor + "-" + binding.launcherSha256
  guard binding.launcherPath == expectedLauncherPath else {
    throw HostFailure("the actor host does not use the canonical content-addressed path")
  }
  let executablePath = try currentExecutablePath()
  guard binding.launcherPath == executablePath else {
    throw HostFailure("the actor host path does not match its root-owned binding")
  }
  try requireTrustedFile(binding.launcherPath, executable: true, label: "actor host executable")
  guard try sha256ForFile(binding.launcherPath) == binding.launcherSha256 else {
    throw HostFailure("the actor host executable does not match its pinned digest")
  }

  let canonicalRuntimeRoot = try canonicalExistingPath(runtimeRoot(arguments), label: "actor runtime root")
  try requireTrustedHierarchy(canonicalRuntimeRoot, label: "actor runtime root")
  let expectedRuntimeDirectory = canonicalRuntimeRoot + "/" + runtimeDigest(binding)
  guard binding.nodePath == expectedRuntimeDirectory + "/node",
    binding.controlEntryPath == expectedRuntimeDirectory + "/automation-control.mjs",
    binding.controlLibraryPath == expectedRuntimeDirectory + "/lib/automation-control.mjs",
    binding.kernelGuardContractPath == expectedRuntimeDirectory + "/lib/automation-kernel-guard-contract.mjs",
    binding.outcomeLedgerRepairContractPath == expectedRuntimeDirectory + "/lib/outcome-ledger-repair-contract.mjs",
    binding.leaseArchiveHelperPath == expectedRuntimeDirectory + "/lib/lease-archive-move.py"
  else {
    throw HostFailure("the pinned actor runtime does not use the canonical content-addressed layout")
  }
  let runtimePins = [
    (binding.nodePath, binding.nodeSha256, true, "Node runtime"),
    (binding.controlEntryPath, binding.controlEntrySha256, false, "automation control entry"),
    (binding.controlLibraryPath, binding.controlLibrarySha256, false, "automation control library"),
    (binding.kernelGuardContractPath, binding.kernelGuardContractSha256, false, "automation kernel guard contract"),
    (binding.outcomeLedgerRepairContractPath, binding.outcomeLedgerRepairContractSha256, false, "outcome ledger repair contract"),
    (binding.leaseArchiveHelperPath, binding.leaseArchiveHelperSha256, false, "lease archive helper"),
  ]
  for (runtimePath, digest, executable, label) in runtimePins {
    let canonical = try canonicalExistingPath(runtimePath, label: label)
    guard isStrictChild(canonical, of: canonicalRuntimeRoot) else {
      throw HostFailure("\(label) must be a strict child of the actor runtime root")
    }
    try requireTrustedFile(canonical, executable: executable, label: label)
    guard try sha256ForFile(canonical) == digest else {
      throw HostFailure("\(label) does not match its pinned digest")
    }
  }

  let canonicalStateRoot = try canonicalExistingPath(arguments.stateRoot, label: "automation state root")
  guard binding.stateRoot == canonicalStateRoot else {
    throw HostFailure("the automation state root is not canonical")
  }
  try requireOwnerDirectory(canonicalStateRoot, label: "automation state root")
  return binding
}

private func credentialPath(for binding: LauncherBinding) -> String {
  binding.stateRoot + "/control/actor-credentials/" + binding.actor + ".json"
}

private func readAndValidateCredential(_ binding: LauncherBinding) throws -> ActorCredentialRecord {
  let path = credentialPath(for: binding)
  let parent = URL(fileURLWithPath: path).deletingLastPathComponent().path
  try requireOwnerDirectory(parent, label: "actor credential directory")
  let data = try readSecureFile(
    path,
    maximumBytes: maximumCredentialBytes,
    allowedOwners: [getuid()],
    requiredMode: 0o600
  )
  let credential = try decodeStrict(
    ActorCredentialRecord.self,
    data: data,
    expectedKeys: ["schemaVersion", "actor", "purpose", "tokenSha256"],
    label: "actor credential record"
  )
  guard credential.schemaVersion == credentialSchemaVersion,
    credential.actor == binding.actor,
    credential.purpose == credentialPurpose
  else {
    throw HostFailure("the actor credential record identity is invalid")
  }
  try requireLowercaseHex(credential.tokenSha256, length: 64, label: "actor credential digest")
  return credential
}

private func validateSecret(_ secret: Data, credential: ActorCredentialRecord) throws {
  guard secret.count == 64,
    secret.allSatisfy({ byte in
      (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
    })
  else {
    throw HostFailure("the actor Keychain credential has an invalid representation")
  }
  let digest = sha256Hex(secret)
  guard digest == credential.tokenSha256 else {
    throw HostFailure("the actor Keychain credential does not match the owner-held digest")
  }
}

private func encodeJSON<T: Encodable>(_ value: T) throws -> Data {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  return try encoder.encode(value)
}

private func encodeJSONLine<T: Encodable>(_ value: T) throws -> Data {
  var data = try encodeJSON(value)
  data.append(0x0a)
  return data
}

private func invokeControl(
  binding: LauncherBinding,
  persistentCredential: Data,
  context: LeaseOperationContext,
  invoker: ControlInvoker,
  lifecycleDeadlineMilliseconds: UInt64,
  cancellationController: ActorCancellationController
) throws -> LeaseHandoff {
  let invocation = ControlInvocation(
    executable: binding.nodePath,
    arguments: [
      binding.controlEntryPath,
      "lease", "acquire",
      "--state-root", binding.stateRoot,
      "--name", binding.leaseName,
      "--owner", binding.actor,
      "--ttl-seconds", String(leaseLifetimeSeconds),
    ],
    operationId: context.operationId,
    leaseToken: context.leaseToken
  )
  let responseData = try invoker.run(
    invocation,
    binding: binding,
    persistentCredential: persistentCredential,
    lifecycleDeadlineMilliseconds: lifecycleDeadlineMilliseconds,
    cancellationController: cancellationController
  )
  guard responseData.count <= maximumControlOutputBytes else {
    throw HostFailure("the pinned automation control process returned too much output")
  }
  let response: ControlEnvelope
  do {
    response = try JSONDecoder().decode(ControlEnvelope.self, from: responseData)
  } catch {
    throw HostFailure("the pinned automation control response is invalid")
  }
  let lease = response.result.lease
  guard response.ok,
    response.schemaVersion == 1,
    response.action == "lease.acquire",
    response.stateRoot == binding.stateRoot,
    response.result.acquired,
    lease.name == binding.leaseName,
    lease.owner == binding.actor,
    lease.token == context.leaseToken,
    lease.credentialKind == "persistent-actor",
    lease.ttlMs == leaseLifetimeMilliseconds,
    lease.token.utf8.count >= 32,
    lease.token.utf8.count <= 4 * 1_024,
    let acquiredAt = parseControlTimestamp(lease.acquiredAt),
    let expiresAt = parseControlTimestamp(lease.expiresAt),
    expiresAt.timeIntervalSince(acquiredAt) <= Double(leaseLifetimeSeconds),
    expiresAt > acquiredAt
  else {
    throw HostFailure("the pinned automation control response did not contain a bounded canonical lease")
  }
  return LeaseHandoff(
    schemaVersion: 1,
    actor: binding.actor,
    leaseName: binding.leaseName,
    leaseOperationId: context.operationId,
    leaseToken: lease.token,
    leaseTokenSha256: context.leaseTokenSha256,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    ttlMs: lease.ttlMs
  )
}

private func inspectAcquiredLease(
  binding: LauncherBinding,
  invoker: ControlInvoker,
  lifecycleDeadlineMilliseconds: UInt64
) throws -> PublicControlLease? {
  let responseData = try invoker.run(
    ControlInvocation(
      executable: binding.nodePath,
      arguments: [
        binding.controlEntryPath,
        "lease", "show",
        "--state-root", binding.stateRoot,
        "--name", binding.leaseName,
      ],
      operationId: nil,
      leaseToken: nil
    ),
    binding: binding,
    persistentCredential: nil,
    lifecycleDeadlineMilliseconds: lifecycleDeadlineMilliseconds,
    cancellationController: nil
  )
  guard responseData.count <= maximumControlOutputBytes,
    let envelope = try? JSONDecoder().decode(LeaseShowEnvelope.self, from: responseData),
    envelope.ok,
    envelope.schemaVersion == 1,
    envelope.action == "lease.show",
    envelope.stateRoot == binding.stateRoot
  else {
    throw HostFailure("the pinned automation control lease inspection was invalid")
  }
  return envelope.result
}

private func releaseAcquiredLease(
  binding: LauncherBinding,
  context: LeaseOperationContext,
  releaseOperationId: String,
  invoker: ControlInvoker,
  lifecycleDeadlineMilliseconds: UInt64
) throws {
  let invocation = ControlInvocation(
    executable: binding.nodePath,
    arguments: [
      binding.controlEntryPath,
      "lease", "release",
      "--state-root", binding.stateRoot,
      "--name", binding.leaseName,
    ],
    operationId: releaseOperationId,
    leaseToken: context.leaseToken
  )
  for _ in 0..<2 {
    do {
      let responseData = try invoker.run(
        invocation,
        binding: binding,
        persistentCredential: nil,
        lifecycleDeadlineMilliseconds: lifecycleDeadlineMilliseconds,
        cancellationController: nil
      )
      if responseData.count <= maximumControlOutputBytes,
        let envelope = try? JSONDecoder().decode(LeaseReleaseEnvelope.self, from: responseData),
        envelope.ok,
        envelope.schemaVersion == 1,
        envelope.action == "lease.release",
        envelope.stateRoot == binding.stateRoot,
        envelope.result.released,
        envelope.result.lease.name == binding.leaseName,
        envelope.result.lease.owner == binding.actor
      {
        break
      }
    } catch {
      continue
    }
  }
  for _ in 0..<2 {
    do {
      if try inspectAcquiredLease(
        binding: binding,
        invoker: invoker,
        lifecycleDeadlineMilliseconds: lifecycleDeadlineMilliseconds
      ) == nil {
        return
      }
    } catch {
      continue
    }
  }
  throw HostFailure("a failed acquisition may have left an unknown actor lease live")
}

private func acquireLeaseWithRecovery(
  binding: LauncherBinding,
  persistentCredential: Data,
  context: LeaseOperationContext,
  invoker: ControlInvoker,
  acquisitionDeadlineMilliseconds: UInt64,
  cleanupDeadlineMilliseconds: UInt64,
  cancellationController: ActorCancellationController
) throws -> LeaseHandoff {
  var acquisitionFailure: Error?
  var acquisitionMayHaveStarted = false
  var cancellationSignal: Int32?
  for _ in 0..<2 {
    guard try monotonicMilliseconds() < acquisitionDeadlineMilliseconds else {
      if !acquisitionMayHaveStarted {
        throw HostFailure("the native actor acquisition window was exhausted before lease mutation")
      }
      break
    }
    do {
      return try invokeControl(
        binding: binding,
        persistentCredential: persistentCredential,
        context: context,
        invoker: invoker,
        lifecycleDeadlineMilliseconds: acquisitionDeadlineMilliseconds,
        cancellationController: cancellationController
      )
    } catch let cancellation as ActorControlCancellation {
      if !cancellation.mutationMayHaveStarted && !acquisitionMayHaveStarted {
        throw ActorCancellation(signal: cancellation.signal)
      }
      acquisitionMayHaveStarted = true
      cancellationSignal = cancellation.signal
      acquisitionFailure = cancellation
      break
    } catch {
      acquisitionMayHaveStarted = true
      acquisitionFailure = error
    }
  }
  let releaseOperationId = try newLeaseOperationId()
  try releaseAcquiredLease(
    binding: binding,
    context: context,
    releaseOperationId: releaseOperationId,
    invoker: invoker,
    lifecycleDeadlineMilliseconds: cleanupDeadlineMilliseconds
  )
  if cancellationSignal == nil,
    let signal = try cancellationController.nextSignal()
  {
    cancellationSignal = signal
  }
  if let cancellationSignal {
    throw ActorCancellation(signal: cancellationSignal)
  }
  throw acquisitionFailure ?? HostFailure("the actor lease acquisition failed")
}

private func parseControlTimestamp(_ value: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: value) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: value)
}

private func main(cancellationController: ActorCancellationController) throws -> Int32 {
  let nativeLifecycleStartedAtMilliseconds = try monotonicMilliseconds()
  let nativeAcquisitionDeadlineMilliseconds =
    nativeLifecycleStartedAtMilliseconds + nativeAcquisitionWindowMilliseconds
  let nativeCleanupDeadlineMilliseconds =
    nativeLifecycleStartedAtMilliseconds + nativeLifecycleBudgetMilliseconds
  let arguments = try parseArguments(Array(CommandLine.arguments.dropFirst()))
  _ = umask(0o077)
  try disableCoreDumps()
  try clearInheritedEnvironment()
  let binding = try loadAndValidateBinding(arguments)
  #if AUTOMATION_ACTOR_HOST_TESTING
    cancellationController.setTestingStateRoot(binding.stateRoot)
  #endif
  let credential = try readAndValidateCredential(binding)
  #if AUTOMATION_ACTOR_HOST_TESTING
    if arguments.testKeychainMode == "signal-preflight-delay" {
      FileManager.default.createFile(
        atPath: URL(fileURLWithPath: binding.stateRoot).deletingLastPathComponent()
          .appendingPathComponent("test-actor-preflight-ready").path,
        contents: Data()
      )
      usleep(2 * 1_000 * 1_000)
    }
  #endif
  #if AUTOMATION_ACTOR_HOST_TESTING
    let interactionController = FakeKeychainInteractionController(
      mode: arguments.testKeychainMode
    )
    let secretReader: SecretReader = FakeSecretReader(
      interactionController: interactionController,
      mode: arguments.testKeychainMode
    )
  #else
    let interactionController = SystemKeychainInteractionController()
    let secretReader: SecretReader = KeychainSecretReader()
  #endif
  var secret = try readSecretWithoutInteraction(
    reader: secretReader,
    interactionController: interactionController,
    service: binding.keychainService,
    account: binding.keychainAccount
  )
  defer { secret.resetBytes(in: 0..<secret.count) }
  try validateSecret(secret, credential: credential)

  switch arguments.mode {
  case .attest:
    guard arguments.credentialSha256 == credential.tokenSha256,
      arguments.requestedKeychainService == binding.keychainService,
      arguments.keychainAccount == binding.keychainAccount
    else {
      throw HostFailure("the readiness request does not match the owner-held credential record")
    }
    let attestationLine = try encodeJSONLine(
      ReadinessAttestation(
        schemaVersion: 1,
        protocolName: attestationProtocol,
        purpose: attestationPurpose,
        actor: binding.actor,
        stateRoot: binding.stateRoot,
        leaseName: binding.leaseName,
        maxLeaseLifetimeMs: binding.maxLeaseLifetimeMs,
        credentialSha256: credential.tokenSha256,
        handoff: binding.handoff,
        keychainService: binding.keychainService,
        keychainAccount: binding.keychainAccount,
        credentialDigestVerified: true,
        canonicalLeaseReady: true,
        mutatesState: false
      )
    )
    if let signal = try cancellationController.nextSignal() {
      throw ActorCancellation(signal: signal)
    }
    FileHandle.standardOutput.write(attestationLine)
    return 0
  case .acquire:
    #if AUTOMATION_ACTOR_HOST_TESTING
      let controlInvoker: ControlInvoker
      if arguments.testControlMode == "process-timeout" {
        controlInvoker = ProcessControlInvoker(
          timeoutMilliseconds: testControlTimeoutMilliseconds
        )
      } else if [
        "process-signal-state",
        "process-cancellation-commit",
        "process-cleanup-cancellation",
      ].contains(arguments.testControlMode) {
        controlInvoker = ProcessControlInvoker(timeoutMilliseconds: 2_000)
      } else {
        controlInvoker = FakeControlInvoker(mode: arguments.testControlMode)
      }
    #else
      let controlInvoker: ControlInvoker = ProcessControlInvoker()
    #endif
    let operation = try newLeaseOperationContext()
    let handoff = try acquireLeaseWithRecovery(
      binding: binding,
      persistentCredential: secret,
      context: operation,
      invoker: controlInvoker,
      acquisitionDeadlineMilliseconds: nativeAcquisitionDeadlineMilliseconds,
      cleanupDeadlineMilliseconds: nativeCleanupDeadlineMilliseconds,
      cancellationController: cancellationController
    )
    let handoffLine = try encodeJSONLine(handoff)
    #if AUTOMATION_ACTOR_HOST_TESTING
      if arguments.testControlMode == "post-child-handoff-delay" {
        FileManager.default.createFile(
          atPath: URL(fileURLWithPath: binding.stateRoot).deletingLastPathComponent()
            .appendingPathComponent("test-actor-handoff-ready").path,
          contents: Data()
        )
        usleep(2 * 1_000 * 1_000)
      }
    #endif
    if let signal = try cancellationController.beginHandoffCommit() {
      let releaseOperationId = try newLeaseOperationId()
      try releaseAcquiredLease(
        binding: binding,
        context: operation,
        releaseOperationId: releaseOperationId,
        invoker: controlInvoker,
        lifecycleDeadlineMilliseconds: nativeCleanupDeadlineMilliseconds
      )
      throw ActorCancellation(signal: signal)
    }
    #if AUTOMATION_ACTOR_HOST_TESTING
      if arguments.testControlMode == "post-final-check-pre-write-delay" {
        FileManager.default.createFile(
          atPath: URL(fileURLWithPath: binding.stateRoot).deletingLastPathComponent()
            .appendingPathComponent("test-actor-handoff-commit-ready").path,
          contents: Data()
        )
        usleep(1_000 * 1_000)
      }
    #endif
    FileHandle.standardOutput.write(handoffLine)
    return 0
  }
}

private func runMain() -> Int32 {
  do {
    let cancellationController = try ActorCancellationController()
    do {
      let status = try main(cancellationController: cancellationController)
      if let signal = try cancellationController.finish() {
        return 128 + signal
      }
      return status
    } catch let cancellation as ActorCancellation {
      let signal = try cancellationController.finish(preferredSignal: cancellation.signal)
      return 128 + (signal ?? cancellation.signal)
    } catch {
      if let signal = try cancellationController.finish() {
        return 128 + signal
      }
      throw error
    }
  } catch let failure as HostFailure {
    fputs("automation-actor-host: \(failure.description)\n", stderr)
    return 1
  } catch {
    fputs("automation-actor-host: an unexpected validation error occurred\n", stderr)
    return 1
  }
}

exit(runMain())
