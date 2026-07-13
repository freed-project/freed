import CryptoKit
import Darwin
import Foundation
import LocalAuthentication
import Security

private let bindingSchemaVersion = 1
private let credentialSchemaVersion = 1
private let bindingPurpose = "automation-actor-launcher"
private let bindingHandoff = "keychain-to-canonical-lease"
private let attestationProtocol = "freed-actor-launcher-readiness-v1"
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

private struct LeaseHandoff: Codable {
  let schemaVersion: Int
  let actor: String
  let leaseName: String
  let leaseToken: String
  let acquiredAt: String
  let expiresAt: String
  let ttlMs: Int
}

private struct ControlInvocation {
  let executable: String
  let arguments: [String]
}

private protocol SecretReader {
  func readSecret(service: String, account: String) throws -> Data
}

private struct KeychainSecretReader: SecretReader {
  func readSecret(service: String, account: String) throws -> Data {
    let authenticationContext = LAContext()
    authenticationContext.interactionNotAllowed = true
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
      kSecUseAuthenticationContext: authenticationContext,
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
  private struct FakeSecretReader: SecretReader {
    func readSecret(service: String, account: String) throws -> Data {
      guard service == keychainService, actorLeaseNames[account] != nil else {
        throw HostFailure("the test Keychain request did not match the actor binding")
      }
      return fakeCredential
    }
  }
#endif

private protocol ControlInvoker {
  func run(
    _ invocation: ControlInvocation,
    binding: LauncherBinding,
    persistentCredential: Data
  ) throws -> Data
}

private struct ProcessControlInvoker: ControlInvoker {
  func run(
    _ invocation: ControlInvocation,
    binding: LauncherBinding,
    persistentCredential: Data
  ) throws -> Data {
    try runBoundedControlProcess(
      invocation,
      persistentCredential: persistentCredential
    )
  }
}

#if AUTOMATION_ACTOR_HOST_TESTING
  private struct FakeControlInvoker: ControlInvoker {
    let mode: String

    func run(
      _ invocation: ControlInvocation,
      binding: LauncherBinding,
      persistentCredential: Data
    ) throws -> Data {
      let expectedArguments = [
        binding.controlEntryPath,
        "lease",
        "acquire",
        "--state-root",
        binding.stateRoot,
        "--name",
        binding.leaseName,
        "--owner",
        binding.actor,
        "--ttl-seconds",
        String(leaseLifetimeSeconds),
      ]
      guard invocation.executable == binding.nodePath,
        invocation.arguments == expectedArguments,
        persistentCredential == fakeCredential,
        inheritedEnvironmentNames().isEmpty
      else {
        throw HostFailure("the test control invocation was not canonical or scrubbed")
      }
      if mode == "oversized" {
        return Data(repeating: 0x61, count: maximumControlOutputBytes + 1)
      }
      let acquiredAt = "2026-07-13T12:00:00.000Z"
      let expiresAt =
        mode == "overlong"
        ? "2026-07-13T12:30:00.001Z"
        : "2026-07-13T12:30:00.000Z"
      let token = mode == "short-token" ? "short" : "test-short-lived-lease-token"
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
  _ = kill(child, SIGKILL)
  var status: Int32 = 0
  while waitpid(child, &status, 0) < 0, errno == EINTR {}
}

private func runBoundedControlProcess(
  _ invocation: ControlInvocation,
  persistentCredential: Data
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

  var credentialEnvironment = Data("FREED_AUTOMATION_ACTOR_TOKEN=".utf8)
  credentialEnvironment.append(persistentCredential)
  defer { credentialEnvironment.resetBytes(in: 0..<credentialEnvironment.count) }
  var environment: [UnsafeMutablePointer<CChar>?] = [
    try environmentArena.append(credentialEnvironment),
    try environmentArena.append("LANG=C"),
    try environmentArena.append("LC_ALL=C"),
    try environmentArena.append("PATH=/usr/bin:/bin"),
    nil,
  ]

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
    guard ["valid", "oversized", "short-token", "overlong"].contains(testControlMode) else {
      throw HostFailure("the actor host test control mode is invalid")
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
      testControlMode: testControlMode
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
    "freed-automation-actor-runtime-v1\n" +
    "node:\(binding.nodeSha256)\n" +
    "automation-control.mjs:\(binding.controlEntrySha256)\n" +
    "lib/automation-control.mjs:\(binding.controlLibrarySha256)\n"
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
    binding.controlLibraryPath == expectedRuntimeDirectory + "/lib/automation-control.mjs"
  else {
    throw HostFailure("the pinned actor runtime does not use the canonical content-addressed layout")
  }
  let runtimePins = [
    (binding.nodePath, binding.nodeSha256, true, "Node runtime"),
    (binding.controlEntryPath, binding.controlEntrySha256, false, "automation control entry"),
    (binding.controlLibraryPath, binding.controlLibrarySha256, false, "automation control library"),
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

private func writeJSON<T: Encodable>(_ value: T) throws {
  let data = try encodeJSON(value)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

private func invokeControl(
  binding: LauncherBinding,
  persistentCredential: Data,
  invoker: ControlInvoker
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
    ]
  )
  let responseData = try invoker.run(
    invocation,
    binding: binding,
    persistentCredential: persistentCredential
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
    lease.credentialKind == "persistent-actor",
    lease.ttlMs == leaseLifetimeMilliseconds,
    lease.token.utf8.count >= 16,
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
    leaseToken: lease.token,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    ttlMs: lease.ttlMs
  )
}

private func parseControlTimestamp(_ value: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: value) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: value)
}

private func main() throws {
  let arguments = try parseArguments(Array(CommandLine.arguments.dropFirst()))
  _ = umask(0o077)
  try disableCoreDumps()
  try clearInheritedEnvironment()
  let binding = try loadAndValidateBinding(arguments)
  let credential = try readAndValidateCredential(binding)
  #if AUTOMATION_ACTOR_HOST_TESTING
    let secretReader: SecretReader = FakeSecretReader()
  #else
    let secretReader: SecretReader = KeychainSecretReader()
  #endif
  var secret = try secretReader.readSecret(
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
    try writeJSON(
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
  case .acquire:
    #if AUTOMATION_ACTOR_HOST_TESTING
      let controlInvoker: ControlInvoker = FakeControlInvoker(
        mode: arguments.testControlMode
      )
    #else
      let controlInvoker: ControlInvoker = ProcessControlInvoker()
    #endif
    let handoff = try invokeControl(
      binding: binding,
      persistentCredential: secret,
      invoker: controlInvoker
    )
    try writeJSON(handoff)
  }
}

do {
  try main()
} catch let failure as HostFailure {
  fputs("automation-actor-host: \(failure.description)\n", stderr)
  exit(1)
} catch {
  fputs("automation-actor-host: an unexpected validation error occurred\n", stderr)
  exit(1)
}
