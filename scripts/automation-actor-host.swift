import CryptoKit
import Darwin
import Foundation

@_silgen_name("getentropy")
private func systemGetEntropy(_ buffer: UnsafeMutableRawPointer?, _ count: Int) -> Int32

private let bindingSchemaVersion = 4
private let bindingPurpose = "automation-actor-launcher"
private let bindingHandoff = "trusted-launcher-channel-to-canonical-lease"
private let attestationProtocol = "freed-actor-launcher-readiness-v3"
private let attestationPurpose = "automation-actor-launcher-readiness"
private let channelProtocol = "freed-actor-launcher-channel-v1"
private let productionBindingRoot =
  "/Library/Application Support/Freed/automation-actor-launchers"
private let productionRuntimeRoot =
  "/Library/Application Support/Freed/automation-actor-runtimes"
private let runtimeDigestProtocol = "freed-automation-actor-runtime-v4"
private let leaseLifetimeMilliseconds = 30 * 60 * 1_000
private let leaseLifetimeSeconds = 30 * 60
private let challengeBytes = 32
private let childChannelDescriptor: Int32 = 3
private let maximumBindingBytes = 32 * 1_024
private let maximumControlOutputBytes = 64 * 1_024
private let maximumAttestationBytes = 16 * 1_024
private let maximumChannelFrameBytes = 8 * 1_024
private let controlTimeoutMilliseconds: UInt64 = 10 * 1_000
private let channelTimeoutMilliseconds: Int32 = 5 * 1_000
#if AUTOMATION_ACTOR_HOST_TESTING
  private let testControlTimeoutMilliseconds: UInt64 = 250
  private let nativeAcquisitionWindowMilliseconds: UInt64 = 5_000
  private let nativeCleanupReserveMilliseconds: UInt64 = 3_000
  private let TEST_LAUNCHER_CHALLENGE_SHA256 = String(repeating: "e", count: 64)
  private let TEST_LAUNCHER_ATTESTATION_SHA256 = String(repeating: "c", count: 64)
  private let TEST_LAUNCHER_SESSION_ID = String(repeating: "d", count: 64)
#else
  // Validation and channel verification share the acquisition window. Once an
  // acquire child may have run, the final 45 seconds belong only to two
  // exact-token release attempts and two absence inspections.
  private let nativeAcquisitionWindowMilliseconds: UInt64 = 20 * 1_000
  private let nativeCleanupReserveMilliseconds: UInt64 = 45 * 1_000
#endif
private let nativeLifecycleBudgetMilliseconds =
  nativeAcquisitionWindowMilliseconds + nativeCleanupReserveMilliseconds
private let actorLeaseNames: [String: String] = [
  "freed-runtime-observer": "runtime-observer",
  "freed-stability-controller": "stability-controller",
  "freed-scaffolding-maintainer": "scaffolding-writer",
  "freed-nightly-runner": "nightly-writer",
  "freed-release-verifier": "release-verifier",
]

private struct ActorLeaseAuthority {
  let observer: String
  let provider: String
}

private let actorLeaseAuthorities: [String: ActorLeaseAuthority] = [
  "freed-runtime-observer": ActorLeaseAuthority(
    observer: "observe-only",
    provider: "forbidden"
  ),
  "freed-stability-controller": ActorLeaseAuthority(
    observer: "plan-only",
    provider: "forbidden"
  ),
  "freed-scaffolding-maintainer": ActorLeaseAuthority(
    observer: "pr-only",
    provider: "forbidden"
  ),
  "freed-nightly-runner": ActorLeaseAuthority(
    observer: "merge-safe",
    provider: "approval-required"
  ),
  "freed-release-verifier": ActorLeaseAuthority(
    observer: "observe-only",
    provider: "forbidden"
  ),
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
  case verifyChannel
}

private struct ParsedArguments {
  let mode: HostMode
  let actor: String
  let stateRoot: String
  let leaseName: String
  let maximumLifetimeMilliseconds: Int
  let channelAction: String?
  let operationId: String?
  let tokenSha256: String?
  let challengeSha256: String?
  let controlPid: pid_t?
  let channelDescriptor: Int32?
  let channelTestMode: String
  #if AUTOMATION_ACTOR_HOST_TESTING
    let testBindingPath: String
    let testRuntimeRoot: String
    let testControlMode: String
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
  let nodePath: String
  let nodeSha256: String
  let actorControlEntryPath: String
  let actorControlEntrySha256: String
  let controlEntryPath: String
  let controlEntrySha256: String
  let controlLibraryPath: String
  let controlLibrarySha256: String
  let readinessLibraryPath: String
  let readinessLibrarySha256: String
  let kernelGuardContractPath: String
  let kernelGuardContractSha256: String
  let outcomeLedgerRepairContractPath: String
  let outcomeLedgerRepairContractSha256: String
  let leaseArchiveHelperPath: String
  let leaseArchiveHelperSha256: String
}

private struct ReadinessAttestation: Codable {
  let schemaVersion: Int
  let protocolName: String
  let purpose: String
  let actor: String
  let stateRoot: String
  let leaseName: String
  let maxLeaseLifetimeMs: Int
  let handoff: String
  let channelProtocol: String
  let launcherSha256: String
  let runtimeDigest: String
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
    case handoff
    case channelProtocol
    case launcherSha256
    case runtimeDigest
    case canonicalLeaseReady
    case mutatesState
  }
}

private struct ChannelAttestation: Codable {
  let schemaVersion: Int
  let protocolName: String
  let action: String
  let actor: String
  let stateRoot: String
  let leaseName: String
  let leaseOperationId: String
  let tokenSha256: String
  let ttlMs: Int
  let launcherPid: Int32
  let launcherStartIdentity: String
  let controlPid: Int32
  let controlStartIdentity: String
  let launcherSha256: String
  let runtimeDigest: String
  let challengeSha256: String
  let sessionId: String
  let launcherIdentityVerified: Bool
  let runtimeIdentityVerified: Bool
  let channelVerified: Bool

  enum CodingKeys: String, CodingKey {
    case schemaVersion
    case protocolName = "protocol"
    case action
    case actor
    case stateRoot
    case leaseName
    case leaseOperationId
    case tokenSha256
    case ttlMs
    case launcherPid
    case launcherStartIdentity
    case controlPid
    case controlStartIdentity
    case launcherSha256
    case runtimeDigest
    case challengeSha256
    case sessionId
    case launcherIdentityVerified
    case runtimeIdentityVerified
    case channelVerified
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
  let takeover: Bool
  let credentialUpgrade: Bool
  let recovered: Bool?
  let lease: ControlLease
}

private struct ControlLease: Decodable {
  let name: String
  let owner: String
  let token: String
  let observerAuthority: String
  let providerAuthority: String
  let credentialKind: String
  let launcherSha256: String
  let actorRuntimeDigest: String
  let launcherChannelProtocol: String
  let launcherAttestationSha256: String
  let launcherSessionId: String
  let acquiredAt: String
  let heartbeatAt: String
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

private struct ProcessIdentity {
  let pid: pid_t
  let parentPid: pid_t
  let uid: uid_t
  let path: String
  let startIdentity: String
}

private struct LeaseOperationContext {
  let operationId: String
  let leaseToken: String
  let leaseTokenSha256: String
}

private struct LauncherChannelFrame: Encodable {
  let schemaVersion: Int
  let action: String
  let leaseOperationId: String
  let leaseToken: String
}

private protocol ControlInvoker {
  func run(
    _ invocation: ControlInvocation,
    binding: LauncherBinding,
    channelContext: LeaseOperationContext?,
    lifecycleDeadlineMilliseconds: UInt64,
    cancellationController: ActorCancellationController?
  ) throws -> Data
}

private struct ProcessControlInvoker: ControlInvoker {
  let timeoutMilliseconds: UInt64
  let channelTestMode: String

  init(
    timeoutMilliseconds: UInt64 = controlTimeoutMilliseconds,
    channelTestMode: String = "valid"
  ) {
    self.timeoutMilliseconds = timeoutMilliseconds
    self.channelTestMode = channelTestMode
  }

  func run(
    _ invocation: ControlInvocation,
    binding: LauncherBinding,
    channelContext: LeaseOperationContext?,
    lifecycleDeadlineMilliseconds: UInt64,
    cancellationController: ActorCancellationController?
  ) throws -> Data {
    try runBoundedControlProcess(
      invocation,
      binding: binding,
      channelContext: channelContext,
      channelTestMode: channelTestMode,
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
      channelContext: LeaseOperationContext?,
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
        "channelAuthorityPresent": channelContext != nil,
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
      guard invocation.executable == binding.nodePath,
        (["attest", "acquire"].contains(action)
          ? channelContext?.operationId == invocation.operationId &&
            channelContext?.leaseToken == invocation.leaseToken
          : channelContext == nil),
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
        binding.actorControlEntryPath,
        "--action", "acquire",
        "--actor", binding.actor,
        "--state-root", binding.stateRoot,
        "--lease-name", binding.leaseName,
        "--ttl-seconds", String(leaseLifetimeSeconds),
        "--challenge-sha256", sha256Hex(channelChallenge(channelContext!)),
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
      var result: [String: Any] = [
        "acquired": true,
        "takeover": false,
        "credentialUpgrade": false,
        "lease": [
          "schemaVersion": 1,
          "name": binding.leaseName,
          "owner": binding.actor,
          "token": token,
          "observerAuthority": actorLeaseAuthorities[binding.actor]!.observer,
          "providerAuthority": actorLeaseAuthorities[binding.actor]!.provider,
          "credentialKind": "trusted-launcher-channel",
          "launcherSha256": binding.launcherSha256,
          "actorRuntimeDigest": runtimeDigest(binding),
          "launcherChannelProtocol": channelProtocol,
          "launcherAttestationSha256": TEST_LAUNCHER_ATTESTATION_SHA256,
          "launcherSessionId": TEST_LAUNCHER_SESSION_ID,
          "acquiredAt": acquiredAt,
          "heartbeatAt": acquiredAt,
          "expiresAt": expiresAt,
          "ttlMs": leaseLifetimeMilliseconds,
        ],
      ]
      if mode == "response-loss-once", acquireAttempts > 1 {
        result["recovered"] = true
      }
      let payload: [String: Any] = [
        "ok": true,
        "schemaVersion": 1,
        "action": "lease.acquire",
        "stateRoot": binding.stateRoot,
        "result": result,
      ]
      return try JSONSerialization.data(withJSONObject: payload)
    }
  }
#endif

private struct CStringArena {
  private(set) var pointers: [UnsafeMutablePointer<CChar>] = []
  private(set) var lengths: [Int] = []

  mutating func append(_ string: String) throws -> UnsafeMutablePointer<CChar> {
    let data = Data(string.utf8)
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
  binding: LauncherBinding,
  channelContext: LeaseOperationContext?,
  channelTestMode: String,
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

  guard (invocation.operationId == nil) == (invocation.leaseToken == nil) else {
    throw HostFailure("the control process lease handoff is incomplete")
  }
  var environment: [UnsafeMutablePointer<CChar>?] = []
  if channelContext == nil,
    let operationId = invocation.operationId,
    let leaseToken = invocation.leaseToken
  {
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
  #if AUTOMATION_ACTOR_HOST_TESTING
    if channelTestMode == "require-output-read-fd3",
      descriptors[0] != childChannelDescriptor
    {
      close(descriptors[0])
      close(descriptors[1])
      throw HostFailure("the control process output pipe did not reserve descriptor 3 for reading")
    }
    if channelTestMode == "require-output-write-fd3",
      descriptors[1] != childChannelDescriptor
    {
      close(descriptors[0])
      close(descriptors[1])
      throw HostFailure("the control process output pipe did not reserve descriptor 3 for writing")
    }
  #endif
  var readDescriptor = descriptors[0]
  var writeDescriptor = descriptors[1]
  do {
    try moveDescriptorAboveStandardStreams(&readDescriptor, label: "control output read")
    try moveDescriptorAboveStandardStreams(&writeDescriptor, label: "control output write")
  } catch {
    if readDescriptor >= 0 { close(readDescriptor) }
    if writeDescriptor >= 0 { close(writeDescriptor) }
    throw error
  }
  var nullDescriptor = open("/dev/null", O_RDONLY | O_CLOEXEC)
  guard nullDescriptor >= 0 else {
    close(readDescriptor)
    close(writeDescriptor)
    throw posixFailure("opening null input for the control process")
  }
  do {
    try moveDescriptorAboveStandardStreams(&nullDescriptor, label: "control null input")
  } catch {
    close(readDescriptor)
    close(writeDescriptor)
    close(nullDescriptor)
    throw error
  }
  var retainedSocket: Int32 = -1
  var childSocket: Int32 = -1
  if let channelContext {
    guard invocation.executable == binding.nodePath,
      invocation.arguments.first == binding.actorControlEntryPath,
      invocation.operationId == channelContext.operationId,
      invocation.leaseToken == channelContext.leaseToken,
      invocation.arguments.count > 2,
      invocation.arguments[1] == "--action",
      ["attest", "acquire"].contains(invocation.arguments[2])
    else {
      close(readDescriptor)
      close(writeDescriptor)
      close(nullDescriptor)
      throw HostFailure("the actor channel invocation is not canonical")
    }
    var sockets = [Int32](repeating: -1, count: 2)
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else {
      close(readDescriptor)
      close(writeDescriptor)
      close(nullDescriptor)
      throw posixFailure("creating the actor control channel")
    }
    retainedSocket = sockets[0]
    childSocket = sockets[1]
    do {
      try moveDescriptorAboveStandardStreams(&retainedSocket, label: "retained actor channel")
      try moveDescriptorAboveStandardStreams(&childSocket, label: "child actor channel")
      let frame = LauncherChannelFrame(
        schemaVersion: 1,
        action: invocation.arguments[2],
        leaseOperationId: channelContext.operationId,
        leaseToken: channelContext.leaseToken
      )
      var payload = try encodeJSONLine(frame)
      var challenge = channelChallenge(channelContext)
      #if AUTOMATION_ACTOR_HOST_TESTING
        if channelTestMode == "missing" {
          challenge.removeAll(keepingCapacity: false)
        } else if channelTestMode == "mismatch" {
          challenge[0] ^= 0xff
        } else if channelTestMode == "extra" {
          challenge.append(0xff)
        }
      #endif
      payload.append(challenge)
      challenge.resetBytes(in: 0..<challenge.count)
      guard payload.count <= maximumChannelFrameBytes + challengeBytes else {
        throw HostFailure("the actor control channel payload exceeded its byte bound")
      }
      try writeAll(retainedSocket, data: payload)
      payload.resetBytes(in: 0..<payload.count)
    } catch {
      close(readDescriptor)
      close(writeDescriptor)
      close(nullDescriptor)
      close(retainedSocket)
      close(childSocket)
      throw error
    }
  }
  var child = pid_t()
  var childStarted = false
  var childWaited = false
  defer {
    close(readDescriptor)
    if writeDescriptor >= 0 { close(writeDescriptor) }
    close(nullDescriptor)
    if retainedSocket >= 0 { close(retainedSocket) }
    if childSocket >= 0 { close(childSocket) }
    if childStarted && !childWaited { terminateChild(child) }
  }

  var fileActions: posix_spawn_file_actions_t? = nil
  var attributes: posix_spawnattr_t? = nil
  guard posix_spawn_file_actions_init(&fileActions) == 0 else {
    throw HostFailure("control process file actions could not be initialized")
  }
  defer { posix_spawn_file_actions_destroy(&fileActions) }
  var fileActionsValid =
    posix_spawn_file_actions_adddup2(&fileActions, nullDescriptor, STDIN_FILENO) == 0 &&
    posix_spawn_file_actions_adddup2(&fileActions, writeDescriptor, STDOUT_FILENO) == 0 &&
    posix_spawn_file_actions_adddup2(&fileActions, writeDescriptor, STDERR_FILENO) == 0 &&
    addRootDirectoryAction(&fileActions) == 0 &&
    posix_spawn_file_actions_addclose(&fileActions, readDescriptor) == 0 &&
    posix_spawn_file_actions_addclose(&fileActions, writeDescriptor) == 0 &&
    posix_spawn_file_actions_addclose(&fileActions, nullDescriptor) == 0
  if childSocket >= 0 {
    fileActionsValid = fileActionsValid &&
      posix_spawn_file_actions_adddup2(
        &fileActions,
        childSocket,
        childChannelDescriptor
      ) == 0 &&
      posix_spawn_file_actions_addclose(&fileActions, childSocket) == 0 &&
      posix_spawn_file_actions_addclose(&fileActions, retainedSocket) == 0
  }
  guard fileActionsValid else {
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
  guard spawnResult == 0 else {
    throw posixFailure("starting the pinned automation control process", code: spawnResult)
  }
  childStarted = true
  if childSocket >= 0 {
    close(childSocket)
    childSocket = -1
  }
  if retainedSocket >= 0 {
    _ = shutdown(retainedSocket, SHUT_WR)
  }
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

private func parsePositiveInt32(_ value: String, label: String) throws -> Int32 {
  guard let parsed = Int32(value), parsed > 0, String(parsed) == value else {
    throw HostFailure("\(label) must be one canonical positive process identity")
  }
  return parsed
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
  let entropyResult = bytes.withUnsafeMutableBytes { rawBuffer in
    systemGetEntropy(rawBuffer.baseAddress, rawBuffer.count)
  }
  guard entropyResult == 0 else {
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

private func channelChallenge(_ context: LeaseOperationContext) -> Data {
  Data(
    SHA256.hash(
      data: Data(
        "freed-actor-channel-challenge-v1\n\(context.operationId)\n\(context.leaseTokenSha256)\n"
          .utf8
      )
    )
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
    if ["--attest-readiness", "--acquire-lease", "--verify-control-channel"].contains(value) {
      guard mode == nil else {
        throw HostFailure("exactly one actor host mode is required")
      }
      if value == "--attest-readiness" {
        mode = .attest
      } else if value == "--acquire-lease" {
        mode = .acquire
      } else {
        mode = .verifyChannel
      }
      index += 1
      continue
    }
    var allowed = Set([
      "--protocol", "--actor", "--state-root", "--lease-name",
      "--max-lifetime-ms", "--ttl-seconds", "--challenge-sha256",
      "--channel-action", "--operation-id", "--token-sha256",
      "--control-pid", "--channel-fd",
    ])
    #if AUTOMATION_ACTOR_HOST_TESTING
      allowed.insert("--test-binding")
      allowed.insert("--test-runtime-root")
      allowed.insert("--test-channel-mode")
      allowed.insert("--test-control-mode")
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
    let leaseName = options["--lease-name"],
    let canonicalLeaseName = actorLeaseNames[actor],
    leaseName == canonicalLeaseName
  else {
    throw HostFailure("the actor host request identity is incomplete or noncanonical")
  }

  let maximumLifetimeMilliseconds: Int
  var channelAction: String?
  var operationId: String?
  var tokenSha256: String?
  var challengeSha256: String?
  var controlPid: pid_t?
  var channelDescriptor: Int32?
  switch mode {
  case .attest:
    guard options["--protocol"] == attestationProtocol,
      options["--max-lifetime-ms"] == String(leaseLifetimeMilliseconds),
      options["--ttl-seconds"] == nil,
      options["--channel-action"] == nil,
      options["--operation-id"] == nil,
      options["--token-sha256"] == nil,
      options["--challenge-sha256"] == nil,
      options["--control-pid"] == nil,
      options["--channel-fd"] == nil
    else {
      throw HostFailure("the actor readiness request is invalid")
    }
    maximumLifetimeMilliseconds = leaseLifetimeMilliseconds
  case .acquire:
    guard options["--protocol"] == nil,
      options["--max-lifetime-ms"] == nil,
      options["--ttl-seconds"] == String(leaseLifetimeSeconds),
      options["--channel-action"] == nil,
      options["--operation-id"] == nil,
      options["--token-sha256"] == nil,
      options["--challenge-sha256"] == nil,
      options["--control-pid"] == nil,
      options["--channel-fd"] == nil
    else {
      throw HostFailure("the actor lease request must use exactly 1,800 seconds")
    }
    maximumLifetimeMilliseconds = leaseLifetimeMilliseconds
  case .verifyChannel:
    guard options["--protocol"] == channelProtocol,
      options["--max-lifetime-ms"] == nil,
      options["--ttl-seconds"] == String(leaseLifetimeSeconds),
      let requestedAction = options["--channel-action"],
      ["attest", "acquire"].contains(requestedAction),
      let requestedOperationId = options["--operation-id"],
      validLeaseOperationId(requestedOperationId),
      let requestedTokenSha256 = options["--token-sha256"],
      let digest = options["--challenge-sha256"],
      let rawControlPid = options["--control-pid"],
      options["--channel-fd"] == String(childChannelDescriptor)
    else {
      throw HostFailure("the actor control channel request is invalid")
    }
    try requireLowercaseHex(digest, length: 64, label: "challenge digest")
    try requireLowercaseHex(
      requestedTokenSha256,
      length: 64,
      label: "lease token digest"
    )
    channelAction = requestedAction
    operationId = requestedOperationId
    tokenSha256 = requestedTokenSha256
    challengeSha256 = digest
    controlPid = try parsePositiveInt32(rawControlPid, label: "control pid")
    channelDescriptor = childChannelDescriptor
    maximumLifetimeMilliseconds = leaseLifetimeMilliseconds
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
        "valid", "process", "oversized", "short-token", "overlong", "response-loss-once",
        "commit-response-loss-near-deadline", "malformed-acquire-and-show", "process-timeout",
        "post-child-handoff-delay", "process-signal-state",
        "process-cancellation-commit", "process-cleanup-cancellation",
        "post-final-check-pre-write-delay",
      ].contains(testControlMode)
    else {
      throw HostFailure("the actor host test control mode is invalid")
    }
    let channelTestMode = options["--test-channel-mode"] ?? "valid"
    guard [
      "valid", "extra", "missing", "mismatch", "require-output-read-fd3",
      "require-output-write-fd3",
    ].contains(channelTestMode) else {
      throw HostFailure("the actor host test channel mode is invalid")
    }
    return ParsedArguments(
      mode: mode,
      actor: actor,
      stateRoot: stateRoot,
      leaseName: leaseName,
      maximumLifetimeMilliseconds: maximumLifetimeMilliseconds,
      channelAction: channelAction,
      operationId: operationId,
      tokenSha256: tokenSha256,
      challengeSha256: challengeSha256,
      controlPid: controlPid,
      channelDescriptor: channelDescriptor,
      channelTestMode: channelTestMode,
      testBindingPath: testBindingPath,
      testRuntimeRoot: testRuntimeRoot,
      testControlMode: testControlMode
    )
  #else
    return ParsedArguments(
      mode: mode,
      actor: actor,
      stateRoot: stateRoot,
      leaseName: leaseName,
      maximumLifetimeMilliseconds: maximumLifetimeMilliseconds,
      channelAction: channelAction,
      operationId: operationId,
      tokenSha256: tokenSha256,
      challengeSha256: challengeSha256,
      controlPid: controlPid,
      channelDescriptor: channelDescriptor,
      channelTestMode: "valid"
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
  let parent = URL(fileURLWithPath: path).deletingLastPathComponent().path
  try requireTrustedHierarchy(parent, label: label)
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
  allowedOwners: Set<uid_t>
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
    value.st_mode & 0o022 == 0,
    value.st_size >= 0,
    value.st_size <= maximumBytes
  else {
    throw HostFailure("an actor host file has an invalid owner, type, mode, or size")
  }
  var data = Data()
  var buffer = [UInt8](repeating: 0, count: min(maximumBytes + 1, 16 * 1_024))
  defer { buffer.resetBytes(in: 0..<buffer.count) }
  while true {
    let count = Darwin.read(descriptor, &buffer, buffer.count)
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
  return data
}

private func sha256Hex(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func sha256ForFile(_ path: String) throws -> String {
  let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw HostFailure("a pinned actor host file cannot be opened")
  }
  defer { close(descriptor) }
  var digest = SHA256()
  var buffer = [UInt8](repeating: 0, count: 1_024 * 1_024)
  defer { buffer.resetBytes(in: 0..<buffer.count) }
  while true {
    let count = Darwin.read(descriptor, &buffer, buffer.count)
    if count == 0 { break }
    if count < 0 {
      if errno == EINTR { continue }
      throw posixFailure("hashing a pinned actor host file")
    }
    digest.update(data: Data(buffer[0..<count]))
  }
  return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func runtimeDigest(_ binding: LauncherBinding) -> String {
  let manifest =
    "\(runtimeDigestProtocol)\n" +
    "node:\(binding.nodeSha256)\n" +
    "automation-control.mjs:\(binding.controlEntrySha256)\n" +
    "automation-actor-control.mjs:\(binding.actorControlEntrySha256)\n" +
    "lib/automation-control.mjs:\(binding.controlLibrarySha256)\n" +
    "lib/automation-actor-readiness.mjs:\(binding.readinessLibrarySha256)\n" +
    "lib/automation-kernel-guard-contract.mjs:\(binding.kernelGuardContractSha256)\n" +
    "lib/outcome-ledger-repair-contract.mjs:\(binding.outcomeLedgerRepairContractSha256)\n" +
    "lib/lease-archive-move.py:\(binding.leaseArchiveHelperSha256)\n"
  return sha256Hex(Data(manifest.utf8))
}

private func decodeStrict<T: Decodable>(
  _ type: T.Type,
  data: Data,
  expectedKeys: Set<String>,
  label: String
) throws -> T {
  guard data.count <= maximumControlOutputBytes else {
    throw HostFailure("\(label) exceeded its output bound")
  }
  let value: Any
  do {
    value = try JSONSerialization.jsonObject(with: data)
  } catch {
    throw HostFailure("\(label) is not valid JSON")
  }
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
      "maxLeaseLifetimeMs", "nodePath", "nodeSha256",
      "controlEntryPath", "controlEntrySha256",
      "actorControlEntryPath", "actorControlEntrySha256",
      "controlLibraryPath", "controlLibrarySha256",
      "readinessLibraryPath", "readinessLibrarySha256",
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
    binding.maxLeaseLifetimeMs == arguments.maximumLifetimeMilliseconds
  else {
    throw HostFailure("the actor launcher binding does not match this request")
  }
  try requireLowercaseHex(binding.launcherSha256, length: 64, label: "launcher digest")
  try requireLowercaseHex(binding.nodeSha256, length: 64, label: "Node digest")
  try requireLowercaseHex(binding.controlEntrySha256, length: 64, label: "control entry digest")
  try requireLowercaseHex(binding.actorControlEntrySha256, length: 64, label: "actor control entry digest")
  try requireLowercaseHex(binding.controlLibrarySha256, length: 64, label: "control library digest")
  try requireLowercaseHex(binding.readinessLibrarySha256, length: 64, label: "readiness library digest")
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

  let canonicalRuntimeRoot = try canonicalExistingPath(
    runtimeRoot(arguments),
    label: "actor runtime root"
  )
  try requireTrustedHierarchy(canonicalRuntimeRoot, label: "actor runtime root")
  let digest = runtimeDigest(binding)
  let expectedRuntimeDirectory = canonicalRuntimeRoot + "/" + digest
  guard binding.nodePath == expectedRuntimeDirectory + "/node",
    binding.actorControlEntryPath == expectedRuntimeDirectory + "/automation-actor-control.mjs",
    binding.controlEntryPath == expectedRuntimeDirectory + "/automation-control.mjs",
    binding.controlLibraryPath == expectedRuntimeDirectory + "/lib/automation-control.mjs",
    binding.readinessLibraryPath == expectedRuntimeDirectory + "/lib/automation-actor-readiness.mjs",
    binding.kernelGuardContractPath == expectedRuntimeDirectory + "/lib/automation-kernel-guard-contract.mjs",
    binding.outcomeLedgerRepairContractPath == expectedRuntimeDirectory + "/lib/outcome-ledger-repair-contract.mjs",
    binding.leaseArchiveHelperPath == expectedRuntimeDirectory + "/lib/lease-archive-move.py"
  else {
    throw HostFailure("the pinned actor runtime does not use the canonical content-addressed layout")
  }
  let runtimePins = [
    (binding.nodePath, binding.nodeSha256, true, "Node runtime"),
    (binding.controlEntryPath, binding.controlEntrySha256, false, "automation control entry"),
    (
      binding.actorControlEntryPath,
      binding.actorControlEntrySha256,
      false,
      "automation actor control entry"
    ),
    (binding.controlLibraryPath, binding.controlLibrarySha256, false, "automation control library"),
    (binding.readinessLibraryPath, binding.readinessLibrarySha256, false, "automation actor readiness library"),
    (binding.kernelGuardContractPath, binding.kernelGuardContractSha256, false, "automation kernel guard contract"),
    (binding.outcomeLedgerRepairContractPath, binding.outcomeLedgerRepairContractSha256, false, "outcome ledger repair contract"),
    (binding.leaseArchiveHelperPath, binding.leaseArchiveHelperSha256, false, "lease archive helper"),
  ]
  for (runtimePath, expectedDigest, executable, label) in runtimePins {
    let canonical = try canonicalExistingPath(runtimePath, label: label)
    guard isStrictChild(canonical, of: canonicalRuntimeRoot) else {
      throw HostFailure("\(label) must be a strict child of the actor runtime root")
    }
    try requireTrustedFile(canonical, executable: executable, label: label)
    guard try sha256ForFile(canonical) == expectedDigest else {
      throw HostFailure("\(label) does not match its pinned digest")
    }
  }

  let canonicalStateRoot = try canonicalExistingPath(
    arguments.stateRoot,
    label: "automation state root"
  )
  guard binding.stateRoot == canonicalStateRoot else {
    throw HostFailure("the automation state root is not canonical")
  }
  try requireOwnerDirectory(canonicalStateRoot, label: "automation state root")
  return binding
}

private func encodeJSON<T: Encodable>(_ value: T) throws -> Data {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let data = try encoder.encode(value)
  guard data.count <= maximumAttestationBytes else {
    throw HostFailure("the actor host response exceeded its output bound")
  }
  return data
}

private func writeJSON<T: Encodable>(_ value: T) throws {
  let data = try encodeJSON(value)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

private func writeAll(_ descriptor: Int32, data: Data) throws {
  try data.withUnsafeBytes { rawBuffer in
    guard let base = rawBuffer.baseAddress else { return }
    var offset = 0
    while offset < data.count {
      let count = Darwin.write(descriptor, base.advanced(by: offset), data.count - offset)
      if count < 0 {
        if errno == EINTR { continue }
        throw posixFailure("writing the actor control channel challenge")
      }
      offset += count
    }
  }
}

private func encodeJSONLine<T: Encodable>(_ value: T) throws -> Data {
  var data = try encodeJSON(value)
  data.append(0x0a)
  return data
}

private func moveDescriptorAboveStandardStreams(
  _ descriptor: inout Int32,
  label: String
) throws {
  let original = descriptor
  let duplicate = fcntl(original, F_DUPFD_CLOEXEC, 10)
  guard duplicate >= 0 else {
    throw posixFailure("isolating the \(label) descriptor")
  }
  descriptor = duplicate
  _ = close(original)
}

private func legacyChannelControlProcess(
  _ invocation: ControlInvocation,
  challenge: Data,
  channelTestMode: String
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
  var environment: [UnsafeMutablePointer<CChar>?] = [
    try environmentArena.append("LANG=C"),
    try environmentArena.append("LC_ALL=C"),
    try environmentArena.append("PATH=/usr/bin:/bin"),
    nil,
  ]

  var outputPipe = [Int32](repeating: -1, count: 2)
  guard pipe(&outputPipe) == 0 else {
    throw posixFailure("creating the control process output pipe")
  }
  #if AUTOMATION_ACTOR_HOST_TESTING
    if channelTestMode == "require-output-read-fd3", outputPipe[0] != childChannelDescriptor {
      close(outputPipe[0])
      close(outputPipe[1])
      throw HostFailure("the control process output pipe did not reserve descriptor 3 for reading")
    }
    if channelTestMode == "require-output-write-fd3", outputPipe[1] != childChannelDescriptor {
      close(outputPipe[0])
      close(outputPipe[1])
      throw HostFailure("the control process output pipe did not reserve descriptor 3 for writing")
    }
  #endif
  var outputRead = outputPipe[0]
  var outputWrite = outputPipe[1]
  do {
    try moveDescriptorAboveStandardStreams(&outputRead, label: "control process output reader")
    try moveDescriptorAboveStandardStreams(&outputWrite, label: "control process output writer")
  } catch {
    close(outputRead)
    close(outputWrite)
    throw error
  }
  var sockets = [Int32](repeating: -1, count: 2)
  guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else {
    close(outputRead)
    close(outputWrite)
    throw posixFailure("creating the actor control channel")
  }
  var retainedSocket = sockets[0]
  var childSocket = sockets[1]
  do {
    try moveDescriptorAboveStandardStreams(&retainedSocket, label: "retained control channel")
    try moveDescriptorAboveStandardStreams(&childSocket, label: "child control channel")
  } catch {
    close(outputRead)
    close(outputWrite)
    close(retainedSocket)
    close(childSocket)
    throw error
  }
  var nullDescriptor = open("/dev/null", O_RDWR | O_CLOEXEC)
  guard nullDescriptor >= 0 else {
    close(outputRead)
    close(outputWrite)
    close(retainedSocket)
    close(childSocket)
    throw posixFailure("opening null streams for the control process")
  }
  do {
    try moveDescriptorAboveStandardStreams(&nullDescriptor, label: "control process null stream")
  } catch {
    close(outputRead)
    close(outputWrite)
    close(retainedSocket)
    close(childSocket)
    close(nullDescriptor)
    throw error
  }

  var child = pid_t()
  var childStarted = false
  var childWaited = false
  var childSocketOpen = true
  defer {
    close(outputRead)
    if outputWrite >= 0 { close(outputWrite) }
    close(retainedSocket)
    if childSocketOpen { close(childSocket) }
    close(nullDescriptor)
    if childStarted && !childWaited { terminateChild(child) }
  }

  try writeAll(retainedSocket, data: challenge)

  var fileActions: posix_spawn_file_actions_t? = nil
  var attributes: posix_spawnattr_t? = nil
  guard posix_spawn_file_actions_init(&fileActions) == 0 else {
    throw HostFailure("control process file actions could not be initialized")
  }
  defer { posix_spawn_file_actions_destroy(&fileActions) }
  guard posix_spawn_file_actions_adddup2(&fileActions, nullDescriptor, STDIN_FILENO) == 0,
    posix_spawn_file_actions_adddup2(&fileActions, outputWrite, STDOUT_FILENO) == 0,
    posix_spawn_file_actions_adddup2(&fileActions, nullDescriptor, STDERR_FILENO) == 0,
    posix_spawn_file_actions_adddup2(&fileActions, childSocket, childChannelDescriptor) == 0,
    addRootDirectoryAction(&fileActions) == 0,
    posix_spawn_file_actions_addclose(&fileActions, outputRead) == 0,
    posix_spawn_file_actions_addclose(&fileActions, outputWrite) == 0,
    posix_spawn_file_actions_addclose(&fileActions, retainedSocket) == 0,
    posix_spawn_file_actions_addclose(&fileActions, childSocket) == 0,
    posix_spawn_file_actions_addclose(&fileActions, nullDescriptor) == 0
  else {
    throw HostFailure("control process descriptors could not be isolated")
  }
  guard posix_spawnattr_init(&attributes) == 0 else {
    throw HostFailure("control process attributes could not be initialized")
  }
  defer { posix_spawnattr_destroy(&attributes) }
  guard posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT)) == 0 else {
    throw HostFailure("control process descriptor isolation could not be enabled")
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
  guard spawnResult == 0 else {
    throw posixFailure("starting the pinned actor control process", code: spawnResult)
  }
  childStarted = true
  close(outputWrite)
  outputWrite = -1
  close(childSocket)
  childSocketOpen = false
  guard fcntl(outputRead, F_SETFL, O_NONBLOCK) == 0 else {
    throw posixFailure("configuring bounded control process output")
  }

  let deadline = try monotonicMilliseconds() + controlTimeoutMilliseconds
  var output = Data()
  var childStatus: Int32?
  var reachedEnd = false
  var buffer = [UInt8](repeating: 0, count: 4 * 1_024)
  defer { buffer.resetBytes(in: 0..<buffer.count) }
  while childStatus == nil || !reachedEnd {
    if try monotonicMilliseconds() >= deadline {
      terminateChild(child)
      childWaited = true
      throw HostFailure("the pinned actor control process timed out")
    }
    var descriptor = pollfd(fd: outputRead, events: Int16(POLLIN | POLLHUP), revents: 0)
    let pollResult = poll(&descriptor, 1, 100)
    if pollResult < 0, errno != EINTR {
      throw posixFailure("polling bounded control process output")
    }
    if pollResult > 0 {
      while true {
        let count = Darwin.read(outputRead, &buffer, buffer.count)
        if count > 0 {
          guard output.count + count <= maximumControlOutputBytes else {
            terminateChild(child)
            childWaited = true
            throw HostFailure("the pinned actor control process returned too much output")
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
        throw posixFailure("checking the pinned actor control process")
      }
    }
  }
  guard let status = childStatus else {
    throw HostFailure("the pinned actor control process ended without status")
  }
  let terminationSignal = status & 0x7f
  guard terminationSignal == 0, ((status >> 8) & 0xff) == 0 else {
    throw HostFailure("the pinned actor control process rejected the request")
  }
  return output
}

private func processIdentity(_ pid: pid_t, label: String) throws -> ProcessIdentity {
  guard pid > 0 else {
    throw HostFailure("the \(label) process identifier is invalid")
  }
  var info = proc_bsdinfo()
  let count = proc_pidinfo(
    pid,
    PROC_PIDTBSDINFO,
    0,
    &info,
    Int32(MemoryLayout<proc_bsdinfo>.size)
  )
  guard count == Int32(MemoryLayout<proc_bsdinfo>.size),
    info.pbi_pid == UInt32(pid),
    info.pbi_start_tvsec > 0
  else {
    throw HostFailure("the \(label) process identity is unavailable")
  }
  var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
  let pathLength = proc_pidpath(pid, &pathBuffer, UInt32(pathBuffer.count))
  guard pathLength > 0 else {
    throw HostFailure("the \(label) executable path is unavailable")
  }
  let path = try canonicalExistingPath(String(cString: pathBuffer), label: "\(label) executable")
  let startIdentity = "\(pid):\(info.pbi_start_tvsec):\(info.pbi_start_tvusec)"
  guard startIdentity.utf8.count <= 128 else {
    throw HostFailure("the \(label) process start identity is invalid")
  }
  return ProcessIdentity(
    pid: pid,
    parentPid: pid_t(info.pbi_ppid),
    uid: uid_t(info.pbi_uid),
    path: path,
    startIdentity: startIdentity
  )
}

private func peerIdentity(_ descriptor: Int32) throws -> ProcessIdentity {
  var peerPid = pid_t()
  var peerPidLength = socklen_t(MemoryLayout<pid_t>.size)
  guard getsockopt(
    descriptor,
    SOL_LOCAL,
    LOCAL_PEERPID,
    &peerPid,
    &peerPidLength
  ) == 0,
    peerPidLength == socklen_t(MemoryLayout<pid_t>.size)
  else {
    throw HostFailure("the actor control channel peer process is unavailable")
  }
  var effectivePeerPid = pid_t()
  var effectivePeerPidLength = socklen_t(MemoryLayout<pid_t>.size)
  guard getsockopt(
    descriptor,
    SOL_LOCAL,
    LOCAL_PEEREPID,
    &effectivePeerPid,
    &effectivePeerPidLength
  ) == 0,
    effectivePeerPidLength == socklen_t(MemoryLayout<pid_t>.size),
    effectivePeerPid == peerPid
  else {
    throw HostFailure("the actor control channel effective peer process is invalid")
  }
  var peerUid = uid_t()
  var peerGid = gid_t()
  guard getpeereid(descriptor, &peerUid, &peerGid) == 0 else {
    throw HostFailure("the actor control channel peer owner is unavailable")
  }
  let identity = try processIdentity(peerPid, label: "launcher peer")
  guard identity.uid == peerUid, peerUid == getuid() else {
    throw HostFailure("the actor control channel peer owner is invalid")
  }
  return identity
}

private func readChallenge(_ descriptor: Int32) throws -> Data {
  var challenge = Data(count: challengeBytes)
  var offset = 0
  let deadline = try monotonicMilliseconds() + UInt64(channelTimeoutMilliseconds)
  while offset < challengeBytes {
    let now = try monotonicMilliseconds()
    guard now < deadline else {
      challenge.resetBytes(in: 0..<challenge.count)
      throw HostFailure("the actor control channel challenge timed out")
    }
    var pollDescriptor = pollfd(
      fd: descriptor,
      events: Int16(POLLIN | POLLHUP | POLLERR),
      revents: 0
    )
    let remaining = Int32(min(UInt64(Int32.max), deadline - now))
    let pollResult = poll(&pollDescriptor, 1, remaining)
    if pollResult < 0 {
      if errno == EINTR { continue }
      challenge.resetBytes(in: 0..<challenge.count)
      throw posixFailure("polling the actor control channel")
    }
    guard pollResult > 0 else { continue }
    let count = challenge.withUnsafeMutableBytes { rawBuffer in
      Darwin.read(
        descriptor,
        rawBuffer.baseAddress!.advanced(by: offset),
        challengeBytes - offset
      )
    }
    if count < 0 {
      if errno == EINTR { continue }
      challenge.resetBytes(in: 0..<challenge.count)
      throw posixFailure("reading the actor control channel challenge")
    }
    guard count > 0 else {
      challenge.resetBytes(in: 0..<challenge.count)
      throw HostFailure("the actor control channel closed before its challenge was complete")
    }
    offset += count
  }
  var extra: UInt8 = 0
  let extraCount = recv(descriptor, &extra, 1, MSG_DONTWAIT)
  guard extraCount == 0 || (extraCount < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) else {
    challenge.resetBytes(in: 0..<challenge.count)
    throw HostFailure("the actor control channel contained more than one challenge")
  }
  return challenge
}

private func verifyControlChannel(
  arguments: ParsedArguments,
  binding: LauncherBinding
) throws -> ChannelAttestation {
  guard let action = arguments.channelAction,
    let operationId = arguments.operationId,
    let tokenSha256 = arguments.tokenSha256,
    let controlPid = arguments.controlPid,
    let channelDescriptor = arguments.channelDescriptor,
    let expectedChallengeSha256 = arguments.challengeSha256,
    controlPid == getppid()
  else {
    throw HostFailure("the actor control process is not the verifier parent")
  }
  let control = try processIdentity(controlPid, label: "actor control")
  let launcher = try peerIdentity(channelDescriptor)
  guard control.parentPid == launcher.pid,
    control.uid == getuid(),
    control.path == binding.nodePath,
    launcher.path == binding.launcherPath,
    try sha256ForFile(control.path) == binding.nodeSha256,
    try sha256ForFile(launcher.path) == binding.launcherSha256
  else {
    throw HostFailure("the actor control channel process chain does not match the binding")
  }
  var challenge = try readChallenge(channelDescriptor)
  defer { challenge.resetBytes(in: 0..<challenge.count) }
  let actualChallengeSha256 = sha256Hex(challenge)
  guard actualChallengeSha256 == expectedChallengeSha256 else {
    throw HostFailure("the actor control channel challenge does not match its digest")
  }
  let digest = runtimeDigest(binding)
  let sessionMaterial = [
    channelProtocol,
    action,
    binding.actor,
    binding.stateRoot,
    binding.leaseName,
    operationId,
    tokenSha256,
    String(leaseLifetimeMilliseconds),
    launcher.startIdentity,
    control.startIdentity,
    binding.launcherSha256,
    digest,
    actualChallengeSha256,
    "",
  ].joined(separator: "\n")
  return ChannelAttestation(
    schemaVersion: 1,
    protocolName: channelProtocol,
    action: action,
    actor: binding.actor,
    stateRoot: binding.stateRoot,
    leaseName: binding.leaseName,
    leaseOperationId: operationId,
    tokenSha256: tokenSha256,
    ttlMs: leaseLifetimeMilliseconds,
    launcherPid: launcher.pid,
    launcherStartIdentity: launcher.startIdentity,
    controlPid: control.pid,
    controlStartIdentity: control.startIdentity,
    launcherSha256: binding.launcherSha256,
    runtimeDigest: digest,
    challengeSha256: actualChallengeSha256,
    sessionId: sha256Hex(Data(sessionMaterial.utf8)),
    launcherIdentityVerified: true,
    runtimeIdentityVerified: true,
    channelVerified: true
  )
}

private func actorControlInvocation(
  binding: LauncherBinding,
  action: String,
  context: LeaseOperationContext
) -> ControlInvocation {
  ControlInvocation(
    executable: binding.nodePath,
    arguments: [
      binding.actorControlEntryPath,
      "--action", action,
      "--actor", binding.actor,
      "--state-root", binding.stateRoot,
      "--lease-name", binding.leaseName,
      "--ttl-seconds", String(leaseLifetimeSeconds),
      "--challenge-sha256", sha256Hex(channelChallenge(context)),
    ],
    operationId: context.operationId,
    leaseToken: context.leaseToken
  )
}

private func validateReadinessResponse(
  _ data: Data,
  binding: LauncherBinding
) throws -> ReadinessAttestation {
  let attestation = try decodeStrict(
    ReadinessAttestation.self,
    data: data,
    expectedKeys: [
      "schemaVersion", "protocol", "purpose", "actor", "stateRoot", "leaseName",
      "maxLeaseLifetimeMs", "handoff", "channelProtocol", "launcherSha256",
      "runtimeDigest", "canonicalLeaseReady", "mutatesState",
    ],
    label: "actor readiness response"
  )
  guard attestation.schemaVersion == 1,
    attestation.protocolName == attestationProtocol,
    attestation.purpose == attestationPurpose,
    attestation.actor == binding.actor,
    attestation.stateRoot == binding.stateRoot,
    attestation.leaseName == binding.leaseName,
    attestation.maxLeaseLifetimeMs == binding.maxLeaseLifetimeMs,
    attestation.handoff == binding.handoff,
    attestation.channelProtocol == channelProtocol,
    attestation.launcherSha256 == binding.launcherSha256,
    attestation.runtimeDigest == runtimeDigest(binding),
    attestation.canonicalLeaseReady,
    !attestation.mutatesState
  else {
    throw HostFailure("the readiness response does not match the trusted launcher channel")
  }
  return attestation
}

private func invokeControl(
  binding: LauncherBinding,
  context: LeaseOperationContext,
  invoker: ControlInvoker,
  lifecycleDeadlineMilliseconds: UInt64,
  cancellationController: ActorCancellationController
) throws -> LeaseHandoff {
  let responseData = try invoker.run(
    actorControlInvocation(binding: binding, action: "acquire", context: context),
    binding: binding,
    channelContext: context,
    lifecycleDeadlineMilliseconds: lifecycleDeadlineMilliseconds,
    cancellationController: cancellationController
  )
  return try validateLeaseResponse(responseData, binding: binding, context: context)
}

private func validateLeaseResponse(
  _ data: Data,
  binding: LauncherBinding,
  context: LeaseOperationContext
) throws -> LeaseHandoff {
  guard let authority = actorLeaseAuthorities[binding.actor] else {
    throw HostFailure("the actor does not have a canonical lease authority policy")
  }
  let rawEnvelope: [String: Any]
  let rawResult: [String: Any]
  let rawLease: [String: Any]
  do {
    guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(envelope.keys) == ["action", "ok", "result", "schemaVersion", "stateRoot"],
      let result = envelope["result"] as? [String: Any],
      [
        Set(["acquired", "credentialUpgrade", "lease", "takeover"]),
        Set(["acquired", "credentialUpgrade", "lease", "previous", "takeover"]),
        Set(["acquired", "credentialUpgrade", "lease", "recovered", "takeover"]),
        Set([
          "acquired", "credentialUpgrade", "lease", "previous", "recovered", "takeover",
        ]),
      ].contains(Set(result.keys)),
      let lease = result["lease"] as? [String: Any],
      Set(lease.keys) == [
        "acquiredAt", "actorRuntimeDigest", "credentialKind", "expiresAt",
        "heartbeatAt", "launcherAttestationSha256", "launcherChannelProtocol",
        "launcherSessionId", "launcherSha256", "name", "observerAuthority",
        "owner", "providerAuthority", "schemaVersion", "token", "ttlMs",
      ]
    else {
      throw HostFailure("the pinned automation control response has an unsupported shape")
    }
    rawEnvelope = envelope
    rawResult = result
    rawLease = lease
  } catch let failure as HostFailure {
    throw failure
  } catch {
    throw HostFailure("the pinned automation control response is invalid JSON")
  }
  let response: ControlEnvelope
  do {
    response = try JSONDecoder().decode(ControlEnvelope.self, from: data)
  } catch {
    throw HostFailure("the pinned automation control response is invalid")
  }
  let lease = response.result.lease
  let hasPrevious = rawResult["previous"] != nil
  let hasRecovered = rawResult["recovered"] != nil
  guard response.ok,
    rawEnvelope["ok"] as? Bool == true,
    rawResult["acquired"] as? Bool == true,
    rawResult["takeover"] as? Bool == response.result.takeover,
    rawResult["credentialUpgrade"] as? Bool == response.result.credentialUpgrade,
    hasPrevious == response.result.takeover,
    (!hasRecovered && response.result.recovered == nil) ||
      (rawResult["recovered"] as? Bool == true && response.result.recovered == true),
    rawLease["schemaVersion"] as? Int == 1,
    response.schemaVersion == 1,
    response.action == "lease.acquire",
    response.stateRoot == binding.stateRoot,
    response.result.acquired,
    lease.name == binding.leaseName,
    lease.owner == binding.actor,
    lease.token == context.leaseToken,
    lease.observerAuthority == authority.observer,
    lease.providerAuthority == authority.provider,
    lease.credentialKind == "trusted-launcher-channel",
    lease.launcherSha256 == binding.launcherSha256,
    lease.actorRuntimeDigest == runtimeDigest(binding),
    lease.launcherChannelProtocol == channelProtocol,
    lease.ttlMs == leaseLifetimeMilliseconds,
    lease.token.utf8.count >= 32,
    lease.token.utf8.count <= 4 * 1_024,
    lease.acquiredAt == lease.heartbeatAt,
    let acquiredAt = parseControlTimestamp(lease.acquiredAt),
    let expiresAt = parseControlTimestamp(lease.expiresAt),
    expiresAt.timeIntervalSince(acquiredAt) <= Double(leaseLifetimeSeconds),
    expiresAt > acquiredAt
  else {
    throw HostFailure("the pinned automation control response did not contain a bounded canonical lease")
  }
  try requireLowercaseHex(
    lease.launcherAttestationSha256,
    length: 64,
    label: "launcher attestation digest"
  )
  try requireLowercaseHex(
    lease.launcherSessionId,
    length: 64,
    label: "launcher session identity"
  )
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
    channelContext: nil,
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
        channelContext: nil,
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

  switch arguments.mode {
  case .attest:
    let operation = try newLeaseOperationContext()
    let response = try ProcessControlInvoker(
      channelTestMode: arguments.channelTestMode
    ).run(
      actorControlInvocation(binding: binding, action: "attest", context: operation),
      binding: binding,
      channelContext: operation,
      lifecycleDeadlineMilliseconds: nativeAcquisitionDeadlineMilliseconds,
      cancellationController: cancellationController
    )
    let attestationLine = try encodeJSONLine(
      validateReadinessResponse(response, binding: binding)
    )
    if let signal = try cancellationController.nextSignal() {
      throw ActorCancellation(signal: signal)
    }
    FileHandle.standardOutput.write(attestationLine)
    return 0
  case .acquire:
    #if AUTOMATION_ACTOR_HOST_TESTING
      let controlInvoker: ControlInvoker
      if arguments.testControlMode == "process" {
        controlInvoker = ProcessControlInvoker(
          channelTestMode: arguments.channelTestMode
        )
      } else if arguments.testControlMode == "process-timeout" {
        controlInvoker = ProcessControlInvoker(
          timeoutMilliseconds: testControlTimeoutMilliseconds,
          channelTestMode: arguments.channelTestMode
        )
      } else if [
        "process-signal-state",
        "process-cancellation-commit",
        "process-cleanup-cancellation",
      ].contains(arguments.testControlMode) {
        controlInvoker = ProcessControlInvoker(
          timeoutMilliseconds: 2_000,
          channelTestMode: arguments.channelTestMode
        )
      } else {
        controlInvoker = FakeControlInvoker(mode: arguments.testControlMode)
      }
    #else
      let controlInvoker: ControlInvoker = ProcessControlInvoker()
    #endif
    let operation = try newLeaseOperationContext()
    let handoff = try acquireLeaseWithRecovery(
      binding: binding,
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
  case .verifyChannel:
    try writeJSON(try verifyControlChannel(arguments: arguments, binding: binding))
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
