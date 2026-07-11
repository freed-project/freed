import CryptoKit
import Darwin
import Dispatch
import Foundation
import LocalAuthentication
import Security

private let configSchemaVersion = 2
private let keychainService = "freed-pr-publisher"
private let keychainAccount = "freed-pr-publisher-signing-key"
private let productionConfigPath = "/Library/Application Support/Freed/trusted-publisher-host.json"
private let developerDirectory = "/Library/Developer/CommandLineTools"
private let maximumConfigBytes = 32 * 1_024
private let signingKeyBytes = 32
private let publisherCapabilityLifetimeSeconds: TimeInterval = 60
private let publisherLeaseLifetimeMilliseconds = 30 * 60 * 1_000
private let ownerCapabilityLifetimeSeconds: TimeInterval = 60
private let ownerLeaseMaximumMilliseconds = 15 * 60 * 1_000

private struct HostFailure: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

private struct HostConfiguration: Decodable {
  let schemaVersion: Int
  let brokerPath: String
  let brokerSha256: String
  let brokerTeamIdentifier: String
  let brokerSigningIdentifier: String
  let controlRoot: String
  let controlCommit: String
  let stateRoot: String
  let launcherSha256: String
  let automationControlSha256: String
  let automationControlLibrarySha256: String
  let publisherHelperSha256: String
  let githubCLIPath: String
  let githubCLISha256: String
  let nodePath: String
  let nodeSha256: String
  let publisherPublicKeyBase64: String
}

private struct ParsedArguments {
  let configPath: String
  let forwarded: [String]
  let ownerAuthorizationBypassedForTesting: Bool
  #if TRUSTED_PUBLISHER_HOST_TESTING
    let fakeSecretPath: String?
  #endif
}

private struct OwnerCapabilityRequest {
  let taskId: String
  let intentDigest: String
  let leaseTtlMs: Int
}

private struct OwnerCapabilityPayload: Codable {
  let schemaVersion: Int
  let capabilityId: String
  let issuer: String
  let purpose: String
  let actor: String
  let leaseName: String
  let stateRoot: String
  let taskId: String
  let intentDigest: String
  let tokenSha256: String
  let issuedAt: String
  let expiresAt: String
  let leaseTtlMs: Int
}

private struct OwnerCapabilityResult: Codable {
  let schemaVersion: Int
  let capabilityFile: String
  let leaseToken: String
  let taskId: String
  let intentDigest: String
  let leaseTtlMs: Int
  let expiresAt: String
}

private struct PublisherScope: Codable {
  let schemaVersion: Int
  let repo: String
  let worktree: String
  let branch: String
  let base: String
  let baseSha: String
  let headSha: String?
  let publishMode: String
}

private struct PublisherCapabilityPayload: Codable {
  let schemaVersion: Int
  let capabilityId: String
  let issuer: String
  let leaseName: String
  let issuedAt: String
  let expiresAt: String
  let leaseTtlMs: Int
  let scope: PublisherScope
}

private struct PublisherCapabilityEnvelope: Codable {
  let schemaVersion: Int
  let payloadBase64: String
  let signatureBase64: String
}

private struct PublisherPublicKeyRecord: Decodable {
  let schemaVersion: Int
  let actor: String
  let purpose: String
  let publicKeyBase64: String
}

private struct FileMetadata {
  let mode: mode_t
  let owner: uid_t
  let size: off_t
}

private struct CodeIdentity {
  let teamIdentifier: String
  let signingIdentifier: String
}

private struct ValidatedConfiguration {
  let launcher: String
  let controlRoot: String
  let nodePath: String
  let githubCLIPath: String
  let stateRoot: String
  let publisherPublicKey: Data
}

private protocol PublisherSecretProvider {
  func readSecret() throws -> Data
}

private struct KeychainPublisherSecretProvider: PublisherSecretProvider {
  func readSecret() throws -> Data {
    let authenticationContext = LAContext()
    authenticationContext.interactionNotAllowed = true
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: keychainService,
      kSecAttrAccount: keychainAccount,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
      kSecUseAuthenticationContext: authenticationContext,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let secret = item as? Data else {
      throw HostFailure("the freed-pr-publisher Keychain credential is unavailable")
    }
    return secret
  }
}

#if TRUSTED_PUBLISHER_HOST_TESTING
  private struct FilePublisherSecretProvider: PublisherSecretProvider {
    let path: String

    func readSecret() throws -> Data {
      guard inheritedEnvironmentNames().isEmpty else {
        throw HostFailure("the inherited environment was not empty before secret retrieval")
      }
      return try readPrivateRegularFile(path, maximumBytes: signingKeyBytes)
    }
  }
#endif

private func posixMessage(_ operation: String, code: Int32 = errno) -> HostFailure {
  HostFailure("\(operation) failed with errno \(code)")
}

private func currentDirectory() throws -> String {
  guard let pointer = getcwd(nil, 0) else {
    throw posixMessage("reading the caller working directory")
  }
  defer { free(pointer) }
  return String(cString: pointer)
}

private func currentHomeDirectory() throws -> String {
  guard let record = getpwuid(getuid()), let directory = record.pointee.pw_dir else {
    throw HostFailure("the current user home directory is unavailable")
  }
  let value = String(cString: directory)
  guard value.first == "/", !value.contains("\n"), !value.contains("\0") else {
    throw HostFailure("the current user home directory is invalid")
  }
  return value
}

private func currentExecutablePath() throws -> String {
  var size: UInt32 = 0
  _ = _NSGetExecutablePath(nil, &size)
  var buffer = [CChar](repeating: 0, count: Int(size))
  guard _NSGetExecutablePath(&buffer, &size) == 0 else {
    throw HostFailure("the publisher host executable path is unavailable")
  }
  return try canonicalExistingPath(String(cString: buffer), label: "publisher host executable")
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
  let names = inheritedEnvironmentNames()
  for name in names where !name.isEmpty {
    if unsetenv(name) != 0 {
      throw posixMessage("clearing inherited process state")
    }
  }
  guard inheritedEnvironmentNames().isEmpty else {
    throw HostFailure("the inherited environment could not be cleared")
  }
}

private func disableCoreDumps() throws {
  var limit = rlimit(rlim_cur: 0, rlim_max: 0)
  guard setrlimit(RLIMIT_CORE, &limit) == 0 else {
    throw posixMessage("disabling publisher host core dumps")
  }
}

private func validateOwnCodeSignature() throws -> CodeIdentity {
  #if TRUSTED_PUBLISHER_HOST_TESTING
    return CodeIdentity(teamIdentifier: "TESTTEAM01", signingIdentifier: "wtf.freed.publisher-host-test")
  #else
    var code: SecCode?
    guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code else {
      throw HostFailure("the publisher host code signature is unavailable")
    }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
      let staticCode
    else {
      throw HostFailure("the publisher host static code signature is unavailable")
    }
    guard
      SecStaticCodeCheckValidity(
        staticCode,
        SecCSFlags(rawValue: kSecCSStrictValidate),
        nil
      ) == errSecSuccess
    else {
      throw HostFailure("the publisher host code signature is invalid")
    }
    var information: CFDictionary?
    guard
      SecCodeCopySigningInformation(
        staticCode,
        SecCSFlags(rawValue: kSecCSSigningInformation),
        &information
      ) == errSecSuccess,
      let dictionary = information as? [CFString: Any],
      let flags = dictionary[kSecCodeInfoFlags] as? NSNumber,
      let teamIdentifier = dictionary[kSecCodeInfoTeamIdentifier] as? String,
      let signingIdentifier = dictionary[kSecCodeInfoIdentifier] as? String
    else {
      throw HostFailure("the publisher host code signature cannot be inspected")
    }
    let value = flags.uint32Value
    let hardenedRuntimeFlag: UInt32 = 0x0001_0000
    let adHocSignatureFlag: UInt32 = 0x0000_0002
    guard value & hardenedRuntimeFlag != 0,
      value & adHocSignatureFlag == 0
    else {
      throw HostFailure("the publisher host must use a non-adhoc hardened runtime signature")
    }
    return CodeIdentity(
      teamIdentifier: teamIdentifier,
      signingIdentifier: signingIdentifier
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

private func metadataForPath(_ path: String, followSymlinks: Bool = false) throws -> FileMetadata {
  var value = stat()
  let result = followSymlinks ? stat(path, &value) : lstat(path, &value)
  guard result == 0 else {
    throw HostFailure("a trusted host path is unavailable")
  }
  return FileMetadata(mode: value.st_mode, owner: value.st_uid, size: value.st_size)
}

private func requireOwnedDirectory(_ path: String, privatePermissions: Bool, label: String) throws {
  _ = try canonicalExistingPath(path, label: label)
  let metadata = try metadataForPath(path)
  guard metadata.mode & S_IFMT == S_IFDIR else {
    throw HostFailure("\(label) must be a directory and not a symbolic link")
  }
  guard metadata.owner == getuid() else {
    throw HostFailure("\(label) must be owned by the current user")
  }
  let forbiddenPermissions: mode_t = privatePermissions ? 0o077 : 0o022
  guard metadata.mode & forbiddenPermissions == 0 else {
    throw HostFailure("\(label) has unsafe group or world permissions")
  }
}

private func requireImmutableDirectory(_ path: String, label: String) throws {
  let canonical = try canonicalExistingPath(path, label: label)
  var current = "/"
  for component in URL(fileURLWithPath: canonical).pathComponents where component != "/" {
    current = URL(fileURLWithPath: current).appendingPathComponent(component).path
    let metadata = try metadataForPath(current)
    guard metadata.mode & S_IFMT == S_IFDIR, metadata.owner == 0 else {
      throw HostFailure("\(label) must have a root-owned physical directory hierarchy")
    }
    guard metadata.mode & 0o022 == 0 else {
      throw HostFailure("\(label) hierarchy must not be group or world writable")
    }
  }
}

private func requirePrivateDirectory(_ path: String, label: String) throws {
  _ = try canonicalExistingPath(path, label: label)
  let metadata = try metadataForPath(path)
  guard metadata.mode & S_IFMT == S_IFDIR, metadata.owner == getuid() else {
    throw HostFailure("\(label) must be a physical directory owned by the current user")
  }
  guard metadata.mode & 0o777 == 0o700 else {
    throw HostFailure("\(label) must use mode 0700")
  }
}

private func readPrivateRegularFile(
  _ path: String,
  maximumBytes: Int,
  allowedOwners: Set<uid_t> = [getuid()],
  forbiddenPermissions: mode_t = 0o077
) throws -> Data {
  _ = try canonicalExistingPath(path, label: "private host file")
  let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw HostFailure("a private host file cannot be opened")
  }
  defer { close(descriptor) }

  var value = stat()
  guard fstat(descriptor, &value) == 0 else {
    throw posixMessage("inspecting a private host file")
  }
  guard value.st_mode & S_IFMT == S_IFREG, allowedOwners.contains(value.st_uid) else {
    throw HostFailure("a private host file must be a regular file with an approved owner")
  }
  guard value.st_mode & forbiddenPermissions == 0 else {
    throw HostFailure("a private host file has unsafe permissions")
  }
  guard value.st_size >= 0, value.st_size <= maximumBytes else {
    throw HostFailure("a private host file has an invalid size")
  }

  var data = Data()
  data.reserveCapacity(Int(value.st_size))
  var buffer = [UInt8](repeating: 0, count: min(maximumBytes + 1, 16 * 1_024))
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count == 0 {
      break
    }
    if count < 0 {
      if errno == EINTR {
        continue
      }
      throw posixMessage("reading a private host file")
    }
    guard data.count + count <= maximumBytes else {
      throw HostFailure("a private host file exceeds its size limit")
    }
    data.append(buffer, count: count)
  }
  buffer.resetBytes(in: 0..<buffer.count)
  return data
}

private func requireTrustedExecutable(
  _ path: String,
  allowedOwners: Set<uid_t>,
  label: String
) throws {
  _ = try canonicalExistingPath(path, label: label)
  let metadata = try metadataForPath(path)
  guard metadata.mode & S_IFMT == S_IFREG else {
    throw HostFailure("\(label) must be a regular file and not a symbolic link")
  }
  guard allowedOwners.contains(metadata.owner) else {
    throw HostFailure("\(label) has an untrusted owner")
  }
  guard metadata.mode & 0o022 == 0 else {
    throw HostFailure("\(label) must not be group or world writable")
  }
  guard metadata.mode & 0o111 != 0 else {
    throw HostFailure("\(label) must be executable")
  }
}

private func requireTrustedRegularFile(
  _ path: String,
  allowedOwners: Set<uid_t>,
  label: String
) throws {
  _ = try canonicalExistingPath(path, label: label)
  let metadata = try metadataForPath(path)
  guard metadata.mode & S_IFMT == S_IFREG else {
    throw HostFailure("\(label) must be a regular file and not a symbolic link")
  }
  guard allowedOwners.contains(metadata.owner) else {
    throw HostFailure("\(label) has an untrusted owner")
  }
  guard metadata.mode & 0o022 == 0 else {
    throw HostFailure("\(label) must not be group or world writable")
  }
}

private func sha256ForFile(_ path: String) throws -> String {
  let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw HostFailure("a pinned executable cannot be opened")
  }
  defer { close(descriptor) }

  var digest = SHA256()
  var buffer = [UInt8](repeating: 0, count: 1_024 * 1_024)
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count == 0 {
      break
    }
    if count < 0 {
      if errno == EINTR {
        continue
      }
      throw posixMessage("hashing a pinned executable")
    }
    digest.update(data: Data(buffer[0..<count]))
  }
  buffer.resetBytes(in: 0..<buffer.count)
  return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func requireLowercaseHex(_ value: String, length: Int, label: String) throws {
  guard value.utf8.count == length,
    value.utf8.allSatisfy({ byte in
      (byte >= Character("0").asciiValue! && byte <= Character("9").asciiValue!)
        || (byte >= Character("a").asciiValue! && byte <= Character("f").asciiValue!)
    })
  else {
    throw HostFailure("\(label) must be \(length) lowercase hexadecimal characters")
  }
}

private func validTeamIdentifier(_ value: String) -> Bool {
  value.utf8.count == 10 && value.utf8.allSatisfy { byte in
    (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90)
  }
}

private func validSigningIdentifier(_ value: String) -> Bool {
  let bytes = Array(value.utf8)
  guard bytes.count >= 2 else { return false }
  let isAlphaNumeric: (UInt8) -> Bool = { byte in
    (byte >= 48 && byte <= 57) ||
      (byte >= 65 && byte <= 90) ||
      (byte >= 97 && byte <= 122)
  }
  guard isAlphaNumeric(bytes[0]) else { return false }
  return bytes.dropFirst().allSatisfy { byte in
    isAlphaNumeric(byte) || byte == 45 || byte == 46
  }
}

private func runCommand(
  executable: String,
  arguments: [String],
  directory: String,
  homeDirectory: String
) throws -> String {
  let output = Pipe()
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  process.currentDirectoryURL = URL(fileURLWithPath: directory)
  process.environment = [
    "DEVELOPER_DIR": developerDirectory,
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "HOME": homeDirectory,
    "PATH": "/usr/bin:/bin",
  ]
  process.standardOutput = output
  process.standardError = output
  do {
    try process.run()
  } catch {
    throw HostFailure("a trusted checkout validation command could not start")
  }
  let outputData = output.fileHandleForReading.readDataToEndOfFile()
  process.waitUntilExit()
  guard process.terminationReason == .exit, process.terminationStatus == 0 else {
    throw HostFailure("the trusted control checkout failed validation")
  }
  guard let value = String(data: outputData, encoding: .utf8) else {
    throw HostFailure("the trusted control checkout returned invalid output")
  }
  return value.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func requestedBaseBranch(_ arguments: [String]) throws -> String {
  var base = "dev"
  var seen = false
  var index = 0
  while index < arguments.count {
    if arguments[index] == "--base" {
      guard !seen, index + 1 < arguments.count else {
        throw HostFailure("the publisher received an invalid base argument")
      }
      base = arguments[index + 1]
      seen = true
      index += 2
      continue
    }
    index += 1
  }
  guard ["dev", "main", "www"].contains(base) else {
    throw HostFailure("the publisher base must be dev, main, or www")
  }
  return base
}

private func pathContains(_ parent: String, _ child: String) -> Bool {
  child == parent || child.hasPrefix(parent.hasSuffix("/") ? parent : parent + "/")
}

private func publisherMode(base: String, branch: String) throws -> String {
  guard base == "main" else { return "feature-pr" }
  if branch.range(
    of: "^chore/promote-dev-to-main-[a-z0-9][a-z0-9._-]*$",
    options: .regularExpression
  ) != nil {
    return "production-promotion"
  }
  if branch.range(
    of: "^chore/release-[a-z0-9][a-z0-9._-]*$",
    options: .regularExpression
  ) != nil {
    return "production-release-prep"
  }
  throw HostFailure(
    "main publishing is restricted to a production promotion or release-prep branch"
  )
}

private func buildPublisherScope(
  trusted: ValidatedConfiguration,
  forwardedArguments: [String],
  callerDirectory: String,
  homeDirectory: String
) throws -> PublisherScope {
  let base = try requestedBaseBranch(forwardedArguments)
  let candidateRoot = try runCommand(
    executable: "/usr/bin/git",
    arguments: [
      "-c", "core.fsmonitor=false",
      "-c", "core.hooksPath=/dev/null",
      "-C", callerDirectory,
      "rev-parse", "--show-toplevel",
    ],
    directory: callerDirectory,
    homeDirectory: homeDirectory
  )
  let canonicalCandidate = try canonicalExistingPath(candidateRoot, label: "candidate worktree")
  guard !pathContains(trusted.controlRoot, canonicalCandidate),
    !pathContains(canonicalCandidate, trusted.controlRoot)
  else {
    throw HostFailure("the control checkout and candidate worktree must be disjoint")
  }
  let origin = try runCommand(
    executable: "/usr/bin/git",
    arguments: ["-C", canonicalCandidate, "config", "--local", "--get", "remote.origin.url"],
    directory: canonicalCandidate,
    homeDirectory: homeDirectory
  )
  guard origin == "https://github.com/freed-project/freed.git" else {
    throw HostFailure("the candidate origin is not the canonical Freed repository")
  }
  let branch = try runCommand(
    executable: "/usr/bin/git",
    arguments: ["-C", canonicalCandidate, "branch", "--show-current"],
    directory: canonicalCandidate,
    homeDirectory: homeDirectory
  )
  guard !branch.isEmpty, !["dev", "main", "www"].contains(branch) else {
    throw HostFailure("the publisher requires an unprotected candidate branch")
  }
  let publishMode = try publisherMode(base: base, branch: branch)
  let canonicalBaseSha = try runCommand(
    executable: trusted.githubCLIPath,
    arguments: [
      "api", "repos/freed-project/freed/git/ref/heads/\(base)", "--jq", ".object.sha",
    ],
    directory: canonicalCandidate,
    homeDirectory: homeDirectory
  )
  try requireLowercaseHex(canonicalBaseSha, length: 40, label: "canonical base commit")
  _ = try runCommand(
    executable: "/usr/bin/git",
    arguments: [
      "-c", "core.fsmonitor=false",
      "-c", "core.hooksPath=/dev/null",
      "-C", canonicalCandidate,
      "fetch", "https://github.com/freed-project/freed.git",
      "refs/heads/\(base):refs/remotes/origin/\(base)",
    ],
    directory: canonicalCandidate,
    homeDirectory: homeDirectory
  )
  let fetchedBaseSha = try runCommand(
    executable: "/usr/bin/git",
    arguments: ["-C", canonicalCandidate, "rev-parse", "origin/\(base)"],
    directory: canonicalCandidate,
    homeDirectory: homeDirectory
  )
  guard fetchedBaseSha == canonicalBaseSha else {
    throw HostFailure("the candidate base does not match the canonical GitHub base commit")
  }
  let headSha = try runCommand(
    executable: "/usr/bin/git",
    arguments: ["-C", canonicalCandidate, "rev-parse", "HEAD"],
    directory: canonicalCandidate,
    homeDirectory: homeDirectory
  )
  try requireLowercaseHex(headSha, length: 40, label: "candidate head commit")
  if base == "main" {
    let status = try runCommand(
      executable: "/usr/bin/git",
      arguments: [
        "-c", "core.fsmonitor=false",
        "-c", "core.hooksPath=/dev/null",
        "-C", canonicalCandidate,
        "status", "--porcelain", "--untracked-files=all",
      ],
      directory: canonicalCandidate,
      homeDirectory: homeDirectory
    )
    guard status.isEmpty else {
      throw HostFailure("a governed main branch must be committed and clean")
    }
    _ = try runCommand(
      executable: trusted.nodePath,
      arguments: [
        trusted.controlRoot + "/scripts/validate-main-pr.mjs",
        "--cwd=\(canonicalCandidate)",
        "--base-ref=origin/main",
        "--head-ref=\(headSha)",
        "--head-branch=\(branch)",
      ],
      directory: canonicalCandidate,
      homeDirectory: homeDirectory
    )
  }
  return PublisherScope(
    schemaVersion: 2,
    repo: "freed-project/freed",
    worktree: canonicalCandidate,
    branch: branch,
    base: base,
    baseSha: canonicalBaseSha,
    headSha: base == "main" ? headSha : nil,
    publishMode: publishMode
  )
}

private func ensurePrivateDirectoryCreated(_ path: String, label: String) throws {
  try FileManager.default.createDirectory(
    atPath: path,
    withIntermediateDirectories: true,
    attributes: [.posixPermissions: 0o700]
  )
  guard chmod(path, 0o700) == 0 else {
    throw posixMessage("securing \(label)")
  }
  try requirePrivateDirectory(path, label: label)
}

private func isoTimestamp(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}

private func writePublisherCapability(
  trusted: ValidatedConfiguration,
  scope: PublisherScope,
  signingKeyData: Data
) throws -> String {
  let signingKey: Curve25519.Signing.PrivateKey
  do {
    signingKey = try Curve25519.Signing.PrivateKey(rawRepresentation: signingKeyData)
  } catch {
    throw HostFailure("the publisher Keychain signing key is invalid")
  }
  guard signingKey.publicKey.rawRepresentation == trusted.publisherPublicKey else {
    throw HostFailure("the publisher Keychain key does not match the root-owned public key pin")
  }
  let capabilityId = "publisher-capability-\(UUID().uuidString.lowercased())"
  let issuedAt = Date()
  let payload = PublisherCapabilityPayload(
    schemaVersion: 1,
    capabilityId: capabilityId,
    issuer: "freed-pr-publisher",
    leaseName: "pr-publisher",
    issuedAt: isoTimestamp(issuedAt),
    expiresAt: isoTimestamp(issuedAt.addingTimeInterval(publisherCapabilityLifetimeSeconds)),
    leaseTtlMs: publisherLeaseLifetimeMilliseconds,
    scope: scope
  )
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  let payloadData = try encoder.encode(payload)
  let signature: Data
  do {
    signature = try signingKey.signature(for: payloadData)
  } catch {
    throw HostFailure("the publisher capability could not be signed")
  }
  let envelope = PublisherCapabilityEnvelope(
    schemaVersion: 1,
    payloadBase64: payloadData.base64EncodedString(),
    signatureBase64: signature.base64EncodedString()
  )
  let envelopeData = try encoder.encode(envelope) + Data([0x0a])
  let capabilityRoot = trusted.stateRoot + "/control/publisher-capabilities"
  let pendingRoot = capabilityRoot + "/pending"
  let consumedRoot = capabilityRoot + "/consumed"
  try ensurePrivateDirectoryCreated(trusted.stateRoot + "/control", label: "automation control directory")
  try ensurePrivateDirectoryCreated(capabilityRoot, label: "publisher capability directory")
  try ensurePrivateDirectoryCreated(pendingRoot, label: "pending publisher capability directory")
  try ensurePrivateDirectoryCreated(consumedRoot, label: "consumed publisher capability directory")
  let capabilityPath = pendingRoot + "/\(capabilityId).json"
  let descriptor = open(capabilityPath, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
  guard descriptor >= 0 else {
    throw posixMessage("creating the publisher capability")
  }
  defer { close(descriptor) }
  try envelopeData.withUnsafeBytes { bytes in
    var offset = 0
    while offset < bytes.count {
      let written = write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
      if written < 0 {
        if errno == EINTR { continue }
        throw posixMessage("writing the publisher capability")
      }
      offset += written
    }
  }
  guard fsync(descriptor) == 0 else {
    throw posixMessage("syncing the publisher capability")
  }
  return capabilityPath
}

private func writeOwnerCapability(
  trusted: ValidatedConfiguration,
  request: OwnerCapabilityRequest,
  signingKeyData: Data
) throws -> OwnerCapabilityResult {
  let signingKey: Curve25519.Signing.PrivateKey
  do {
    signingKey = try Curve25519.Signing.PrivateKey(rawRepresentation: signingKeyData)
  } catch {
    throw HostFailure("the publisher Keychain signing key is invalid")
  }
  guard signingKey.publicKey.rawRepresentation == trusted.publisherPublicKey else {
    throw HostFailure("the publisher Keychain key does not match the root-owned public key pin")
  }
  let capabilityId = "owner-capability-\(UUID().uuidString.lowercased())"
  let issuedAt = Date()
  let expiresAt = issuedAt.addingTimeInterval(ownerCapabilityLifetimeSeconds)
  let leaseToken = try randomOwnerLeaseToken()
  let tokenSha256 = SHA256.hash(data: Data(leaseToken.utf8))
    .map { String(format: "%02x", $0) }
    .joined()
  let payload = OwnerCapabilityPayload(
    schemaVersion: 1,
    capabilityId: capabilityId,
    issuer: "trusted-publisher-host",
    purpose: "owner-governance-capability",
    actor: "freed-owner",
    leaseName: "owner-governance",
    stateRoot: trusted.stateRoot,
    taskId: request.taskId,
    intentDigest: request.intentDigest,
    tokenSha256: tokenSha256,
    issuedAt: isoTimestamp(issuedAt),
    expiresAt: isoTimestamp(expiresAt),
    leaseTtlMs: request.leaseTtlMs
  )
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  let payloadData = try encoder.encode(payload)
  let signature: Data
  do {
    signature = try signingKey.signature(for: payloadData)
  } catch {
    throw HostFailure("the owner capability could not be signed")
  }
  let envelope = PublisherCapabilityEnvelope(
    schemaVersion: 1,
    payloadBase64: payloadData.base64EncodedString(),
    signatureBase64: signature.base64EncodedString()
  )
  let envelopeData = try encoder.encode(envelope) + Data([0x0a])
  let capabilityRoot = trusted.stateRoot + "/control/owner-capabilities"
  let pendingRoot = capabilityRoot + "/pending"
  let consumedRoot = capabilityRoot + "/consumed"
  try ensurePrivateDirectoryCreated(trusted.stateRoot + "/control", label: "automation control directory")
  try ensurePrivateDirectoryCreated(capabilityRoot, label: "owner capability directory")
  try ensurePrivateDirectoryCreated(pendingRoot, label: "pending owner capability directory")
  try ensurePrivateDirectoryCreated(consumedRoot, label: "consumed owner capability directory")
  let capabilityPath = pendingRoot + "/\(capabilityId).json"
  let descriptor = open(
    capabilityPath,
    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    0o600
  )
  guard descriptor >= 0 else {
    throw posixMessage("creating the owner capability")
  }
  defer { close(descriptor) }
  try envelopeData.withUnsafeBytes { bytes in
    var offset = 0
    while offset < bytes.count {
      let written = write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
      if written < 0 {
        if errno == EINTR { continue }
        throw posixMessage("writing the owner capability")
      }
      offset += written
    }
  }
  guard fsync(descriptor) == 0 else {
    throw posixMessage("syncing the owner capability")
  }
  return OwnerCapabilityResult(
    schemaVersion: 1,
    capabilityFile: capabilityPath,
    leaseToken: leaseToken,
    taskId: request.taskId,
    intentDigest: request.intentDigest,
    leaseTtlMs: request.leaseTtlMs,
    expiresAt: isoTimestamp(expiresAt)
  )
}

private func loadConfiguration(path: String) throws -> HostConfiguration {
  let parent = URL(fileURLWithPath: path).deletingLastPathComponent().path
  #if TRUSTED_PUBLISHER_HOST_TESTING
    try requireOwnedDirectory(
      parent, privatePermissions: false, label: "trusted host config directory")
    let configOwners: Set<uid_t> = [getuid()]
  #else
    try requireImmutableDirectory(parent, label: "trusted host config directory")
    let configOwners: Set<uid_t> = [0]
  #endif
  let data = try readPrivateRegularFile(
    path,
    maximumBytes: maximumConfigBytes,
    allowedOwners: configOwners,
    forbiddenPermissions: 0o022
  )
  let object: Any
  do {
    object = try JSONSerialization.jsonObject(with: data, options: [])
  } catch {
    throw HostFailure("the trusted host config is not valid JSON")
  }
  let requiredKeys: Set<String> = [
    "schemaVersion",
    "brokerPath",
    "brokerSha256",
    "brokerTeamIdentifier",
    "brokerSigningIdentifier",
    "controlRoot",
    "controlCommit",
    "stateRoot",
    "launcherSha256",
    "automationControlSha256",
    "automationControlLibrarySha256",
    "publisherHelperSha256",
    "githubCLIPath",
    "githubCLISha256",
    "nodePath",
    "nodeSha256",
    "publisherPublicKeyBase64",
  ]
  guard let dictionary = object as? [String: Any], Set(dictionary.keys) == requiredKeys else {
    throw HostFailure("the trusted host config has unsupported fields")
  }
  do {
    return try JSONDecoder().decode(HostConfiguration.self, from: data)
  } catch {
    throw HostFailure("the trusted host config has invalid field types")
  }
}

private func validateConfiguration(
  _ configuration: HostConfiguration,
  homeDirectory: String,
  codeIdentity: CodeIdentity
) throws -> ValidatedConfiguration {
  guard configuration.schemaVersion == configSchemaVersion else {
    throw HostFailure("the trusted host config schema is unsupported")
  }
  try requireImmutableDirectory(
    developerDirectory,
    label: "Apple Command Line Tools directory"
  )
  try requireLowercaseHex(configuration.controlCommit, length: 40, label: "control commit")
  try requireLowercaseHex(configuration.brokerSha256, length: 64, label: "broker digest")
  try requireLowercaseHex(configuration.launcherSha256, length: 64, label: "launcher digest")
  try requireLowercaseHex(
    configuration.automationControlSha256, length: 64,
    label: "automation control entry digest")
  try requireLowercaseHex(
    configuration.automationControlLibrarySha256, length: 64,
    label: "automation control library digest")
  try requireLowercaseHex(
    configuration.publisherHelperSha256, length: 64,
    label: "publisher helper digest")
  try requireLowercaseHex(configuration.githubCLISha256, length: 64, label: "GitHub CLI digest")
  try requireLowercaseHex(configuration.nodeSha256, length: 64, label: "Node digest")
  guard validTeamIdentifier(configuration.brokerTeamIdentifier),
    validSigningIdentifier(configuration.brokerSigningIdentifier),
    codeIdentity.teamIdentifier == configuration.brokerTeamIdentifier,
    codeIdentity.signingIdentifier == configuration.brokerSigningIdentifier
  else {
    throw HostFailure("the publisher host does not match the owner-approved signing requirement")
  }

  let brokerPath = try currentExecutablePath()
  guard brokerPath == configuration.brokerPath else {
    throw HostFailure("the publisher host path does not match its root-owned configuration")
  }
  #if TRUSTED_PUBLISHER_HOST_TESTING
    try requireTrustedExecutable(brokerPath, allowedOwners: [getuid()], label: "publisher host")
  #else
    try requireImmutableDirectory(
      URL(fileURLWithPath: brokerPath).deletingLastPathComponent().path,
      label: "publisher host directory"
    )
    try requireTrustedExecutable(brokerPath, allowedOwners: [0], label: "publisher host")
  #endif
  guard try sha256ForFile(brokerPath) == configuration.brokerSha256 else {
    throw HostFailure("the publisher host does not match its pinned digest")
  }

  let controlRoot = try canonicalExistingPath(configuration.controlRoot, label: "control root")
  let scriptsDirectory = controlRoot + "/scripts"
  let launcher = scriptsDirectory + "/trusted-worktree-publish.sh"
  let automationControl = scriptsDirectory + "/automation-control.mjs"
  let automationControlLibrary = scriptsDirectory + "/lib/automation-control.mjs"
  let publisherHelper = scriptsDirectory + "/worktree-publish.sh"
  #if TRUSTED_PUBLISHER_HOST_TESTING
    try requireOwnedDirectory(controlRoot, privatePermissions: false, label: "control root")
    try requireOwnedDirectory(
      scriptsDirectory, privatePermissions: false, label: "control scripts directory")
    try requireTrustedExecutable(
      launcher, allowedOwners: [getuid()], label: "trusted publisher launcher")
    try requireTrustedRegularFile(
      automationControl, allowedOwners: [getuid()], label: "automation control entry")
    try requireTrustedRegularFile(
      automationControlLibrary, allowedOwners: [getuid()], label: "automation control library")
    try requireTrustedExecutable(
      publisherHelper, allowedOwners: [getuid()], label: "publisher helper")
  #else
    try requireImmutableDirectory(controlRoot, label: "control root")
    try requireImmutableDirectory(scriptsDirectory, label: "control scripts directory")
    try requireTrustedExecutable(
      launcher, allowedOwners: [0], label: "trusted publisher launcher")
    try requireTrustedRegularFile(
      automationControl, allowedOwners: [0], label: "automation control entry")
    try requireTrustedRegularFile(
      automationControlLibrary, allowedOwners: [0], label: "automation control library")
    try requireTrustedExecutable(
      publisherHelper, allowedOwners: [0], label: "publisher helper")
  #endif
  guard try sha256ForFile(launcher) == configuration.launcherSha256 else {
    throw HostFailure("the trusted publisher launcher does not match its pinned digest")
  }
  guard try sha256ForFile(automationControl) == configuration.automationControlSha256 else {
    throw HostFailure("the automation control entry does not match its pinned digest")
  }
  guard
    try sha256ForFile(automationControlLibrary)
      == configuration.automationControlLibrarySha256
  else {
    throw HostFailure("the automation control library does not match its pinned digest")
  }
  guard try sha256ForFile(publisherHelper) == configuration.publisherHelperSha256 else {
    throw HostFailure("the publisher helper does not match its pinned digest")
  }

  let stateRoot = try canonicalExistingPath(configuration.stateRoot, label: "automation state root")
  try requirePrivateDirectory(stateRoot, label: "automation state root")

  let githubCLI = try canonicalExistingPath(configuration.githubCLIPath, label: "GitHub CLI")
  #if TRUSTED_PUBLISHER_HOST_TESTING
    try requireTrustedExecutable(githubCLI, allowedOwners: [0, getuid()], label: "GitHub CLI")
  #else
    try requireImmutableDirectory(
      URL(fileURLWithPath: githubCLI).deletingLastPathComponent().path,
      label: "GitHub CLI directory"
    )
    try requireTrustedExecutable(githubCLI, allowedOwners: [0], label: "GitHub CLI")
  #endif
  guard try sha256ForFile(githubCLI) == configuration.githubCLISha256 else {
    throw HostFailure("the GitHub CLI does not match its pinned digest")
  }

  let nodePath = try canonicalExistingPath(configuration.nodePath, label: "Node")
  #if TRUSTED_PUBLISHER_HOST_TESTING
    try requireTrustedExecutable(nodePath, allowedOwners: [0, getuid()], label: "Node")
  #else
    try requireImmutableDirectory(
      URL(fileURLWithPath: nodePath).deletingLastPathComponent().path,
      label: "Node directory"
    )
    try requireTrustedExecutable(nodePath, allowedOwners: [0], label: "Node")
  #endif
  guard try sha256ForFile(nodePath) == configuration.nodeSha256 else {
    throw HostFailure("Node does not match its pinned digest")
  }

  guard let publisherPublicKey = Data(base64Encoded: configuration.publisherPublicKeyBase64),
    publisherPublicKey.count == 32,
    publisherPublicKey.base64EncodedString() == configuration.publisherPublicKeyBase64
  else {
    throw HostFailure("the publisher public key must be 32 canonical base64 bytes")
  }
  let publisherCredentialPath =
    stateRoot + "/control/actor-credentials/freed-pr-publisher.json"
  let publisherCredentialMetadata = try metadataForPath(publisherCredentialPath)
  guard publisherCredentialMetadata.mode & 0o777 == 0o600 else {
    throw HostFailure("the publisher public key record must use mode 0600")
  }
  let publisherCredentialData = try readPrivateRegularFile(
    publisherCredentialPath,
    maximumBytes: 8 * 1_024
  )
  let publisherCredentialObject: Any
  do {
    publisherCredentialObject = try JSONSerialization.jsonObject(
      with: publisherCredentialData,
      options: []
    )
  } catch {
    throw HostFailure("the publisher public key record is not valid JSON")
  }
  let publisherCredentialKeys: Set<String> = [
    "schemaVersion", "actor", "purpose", "publicKeyBase64",
  ]
  guard
    let publisherCredentialDictionary = publisherCredentialObject as? [String: Any],
    Set(publisherCredentialDictionary.keys) == publisherCredentialKeys,
    let publisherCredential = try? JSONDecoder().decode(
      PublisherPublicKeyRecord.self,
      from: publisherCredentialData
    ),
    publisherCredential.schemaVersion == 1,
    publisherCredential.actor == "freed-pr-publisher",
    publisherCredential.purpose == "publisher-capability-signing",
    publisherCredential.publicKeyBase64 == configuration.publisherPublicKeyBase64
  else {
    throw HostFailure("the publisher public key record does not match the root-owned key pin")
  }

  let repositoryRoot = try runCommand(
    executable: "/usr/bin/git",
    arguments: [
      "-c", "core.fsmonitor=false",
      "-c", "core.hooksPath=/dev/null",
      "-C", controlRoot,
      "rev-parse", "--show-toplevel",
    ],
    directory: controlRoot,
    homeDirectory: homeDirectory
  )
  guard repositoryRoot == controlRoot else {
    throw HostFailure("the control root is not the root of its Git checkout")
  }
  let head = try runCommand(
    executable: "/usr/bin/git",
    arguments: [
      "-c", "core.fsmonitor=false",
      "-c", "core.hooksPath=/dev/null",
      "-C", controlRoot,
      "rev-parse", "HEAD",
    ],
    directory: controlRoot,
    homeDirectory: homeDirectory
  )
  guard head == configuration.controlCommit else {
    throw HostFailure("the control checkout does not match its pinned commit")
  }
  let status = try runCommand(
    executable: "/usr/bin/git",
    arguments: [
      "-c", "core.fsmonitor=false",
      "-c", "core.hooksPath=/dev/null",
      "-C", controlRoot,
      "status", "--porcelain", "--untracked-files=all",
    ],
    directory: controlRoot,
    homeDirectory: homeDirectory
  )
  guard status.isEmpty else {
    throw HostFailure("the control checkout is not clean")
  }

  return ValidatedConfiguration(
    launcher: launcher,
    controlRoot: controlRoot,
    nodePath: nodePath,
    githubCLIPath: githubCLI,
    stateRoot: stateRoot,
    publisherPublicKey: publisherPublicKey
  )
}

private func parseArguments(_ arguments: [String], homeDirectory: String) throws -> ParsedArguments
{
  let defaultConfig = productionConfigPath
  #if TRUSTED_PUBLISHER_HOST_TESTING
    var index = 0
    var configPath = defaultConfig
    var fakeSecretPath: String?
    var ownerAuthorizationBypassedForTesting = false
    while index < arguments.count {
      if arguments[index] == "--" {
        index += 1
        break
      }
      if arguments[index] == "--test-config", index + 1 < arguments.count {
        configPath = arguments[index + 1]
        index += 2
        continue
      }
      if arguments[index] == "--test-secret-file", index + 1 < arguments.count {
        fakeSecretPath = arguments[index + 1]
        index += 2
        continue
      }
      if arguments[index] == "--test-owner-authorized" {
        ownerAuthorizationBypassedForTesting = true
        index += 1
        continue
      }
      break
    }
    return ParsedArguments(
      configPath: configPath,
      forwarded: Array(arguments[index...]),
      ownerAuthorizationBypassedForTesting: ownerAuthorizationBypassedForTesting,
      fakeSecretPath: fakeSecretPath
    )
  #else
    return ParsedArguments(
      configPath: defaultConfig,
      forwarded: arguments,
      ownerAuthorizationBypassedForTesting: false
    )
  #endif
}

private func validControlIdentifier(_ value: String) -> Bool {
  guard !value.isEmpty, value.count <= 128 else { return false }
  return value.range(
    of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    options: .regularExpression
  ) != nil
}

private func parseOwnerCapabilityRequest(_ arguments: [String]) throws -> OwnerCapabilityRequest? {
  guard arguments.first == "owner-capability" else { return nil }
  guard arguments.count == 7,
    arguments[1] == "--task-id",
    arguments[3] == "--intent-digest",
    arguments[5] == "--ttl-seconds"
  else {
    throw HostFailure(
      "owner-capability requires --task-id, --intent-digest, and --ttl-seconds"
    )
  }
  let taskId = arguments[2]
  let intentDigest = arguments[4]
  guard validControlIdentifier(taskId) else {
    throw HostFailure("the owner capability task id is invalid")
  }
  try requireLowercaseHex(intentDigest, length: 64, label: "owner intent digest")
  guard let ttlSeconds = Int(arguments[6]), ttlSeconds > 0,
    ttlSeconds <= ownerLeaseMaximumMilliseconds / 1_000
  else {
    throw HostFailure("the owner lease lifetime must be between 1 and 900 seconds")
  }
  return OwnerCapabilityRequest(
    taskId: taskId,
    intentDigest: intentDigest,
    leaseTtlMs: ttlSeconds * 1_000
  )
}

private func requireOwnerAuthorization(
  request: OwnerCapabilityRequest,
  bypassedForTesting: Bool
) throws {
  #if TRUSTED_PUBLISHER_HOST_TESTING
    guard bypassedForTesting else {
      throw HostFailure("device owner authentication is required for governance approval")
    }
    return
  #else
    let context = LAContext()
    var policyError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
      throw HostFailure("device owner authentication is unavailable for governance approval")
    }
    let semaphore = DispatchSemaphore(value: 0)
    let authorizationLock = NSLock()
    var authorized = false
    context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason:
        "Approve Freed governance task \(request.taskId), intent SHA-256 \(request.intentDigest)"
    ) { success, _ in
      authorizationLock.lock()
      authorized = success
      authorizationLock.unlock()
      semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 120) == .success else {
      context.invalidate()
      throw HostFailure("device owner authentication timed out for governance approval")
    }
    authorizationLock.lock()
    let approved = authorized
    authorizationLock.unlock()
    context.invalidate()
    guard approved else {
      throw HostFailure("device owner authentication did not approve the governance capability")
    }
  #endif
}

private func randomOwnerLeaseToken() throws -> String {
  var bytes = [UInt8](repeating: 0, count: 32)
  guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
    throw HostFailure("the owner lease token could not be generated")
  }
  defer { bytes.resetBytes(in: 0..<bytes.count) }
  return Data(bytes).base64EncodedString()
}

private func validateSecret(_ secret: Data) throws {
  guard secret.count == signingKeyBytes else {
    throw HostFailure("the freed-pr-publisher Keychain signing key must contain exactly 32 bytes")
  }
}

private struct CStringArena {
  private(set) var pointers: [UnsafeMutablePointer<CChar>] = []
  private(set) var lengths: [Int] = []

  mutating func append(_ string: String) throws -> UnsafeMutablePointer<CChar> {
    try append(Data(string.utf8))
  }

  mutating func append(_ data: Data) throws -> UnsafeMutablePointer<CChar> {
    guard !data.contains(0) else {
      throw HostFailure("a child process value contains a null byte")
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

private func runLauncher(
  path: String,
  arguments: [String],
  callerDirectory: String,
  homeDirectory: String,
  configuration: HostConfiguration,
  trusted: ValidatedConfiguration,
  capabilityPath: String
) throws -> Int32 {
  guard try currentDirectory() == callerDirectory else {
    throw HostFailure("the publisher caller directory changed during validation")
  }
  var argumentArena = CStringArena()
  var environmentArena = CStringArena()
  defer {
    argumentArena.destroy()
    environmentArena.destroy()
  }

  var argumentPointers: [UnsafeMutablePointer<CChar>?] = []
  argumentPointers.append(try argumentArena.append(path))
  for argument in arguments {
    argumentPointers.append(try argumentArena.append(argument))
  }
  argumentPointers.append(nil)

  let publicEnvironment = [
    "DEVELOPER_DIR=\(developerDirectory)",
    "HOME=\(homeDirectory)",
    "PATH=/usr/bin:/bin",
    "FREED_TRUSTED_CONTROL_SHA=\(configuration.controlCommit)",
    "FREED_TRUSTED_STATE_ROOT=\(configuration.stateRoot)",
    "FREED_TRUSTED_GH_BIN=\(configuration.githubCLIPath)",
    "FREED_TRUSTED_GH_SHA256=\(configuration.githubCLISha256)",
    "FREED_TRUSTED_NODE_BIN=\(trusted.nodePath)",
    "FREED_TRUSTED_NODE_SHA256=\(configuration.nodeSha256)",
    "FREED_PUBLISHER_CAPABILITY_FILE=\(capabilityPath)",
  ]
  var environmentPointers: [UnsafeMutablePointer<CChar>?] = []
  for value in publicEnvironment {
    environmentPointers.append(try environmentArena.append(value))
  }
  environmentPointers.append(nil)

  var fileActions: posix_spawn_file_actions_t? = nil
  var attributes: posix_spawnattr_t? = nil
  guard posix_spawn_file_actions_init(&fileActions) == 0 else {
    throw HostFailure("publisher process file actions could not be initialized")
  }
  defer { posix_spawn_file_actions_destroy(&fileActions) }
  for descriptor in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] {
    guard posix_spawn_file_actions_adddup2(&fileActions, descriptor, descriptor) == 0 else {
      throw HostFailure("publisher standard streams could not be preserved")
    }
  }
  guard posix_spawnattr_init(&attributes) == 0 else {
    throw HostFailure("publisher process attributes could not be initialized")
  }
  defer { posix_spawnattr_destroy(&attributes) }
  let flags = Int16(POSIX_SPAWN_CLOEXEC_DEFAULT)
  guard posix_spawnattr_setflags(&attributes, flags) == 0 else {
    throw HostFailure("publisher process descriptor isolation could not be enabled")
  }

  var child = pid_t()
  let spawnResult = argumentPointers.withUnsafeMutableBufferPointer { argumentBuffer in
    environmentPointers.withUnsafeMutableBufferPointer { environmentBuffer in
      path.withCString { executable in
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
  guard spawnResult == 0 else {
    throw posixMessage("starting the trusted publisher", code: spawnResult)
  }

  var status: Int32 = 0
  while waitpid(child, &status, 0) < 0 {
    if errno == EINTR {
      continue
    }
    throw posixMessage("waiting for the trusted publisher")
  }
  let terminationSignal = status & 0x7f
  if terminationSignal == 0 {
    return (status >> 8) & 0xff
  }
  if terminationSignal != 0x7f {
    return 128 + terminationSignal
  }
  return 1
}

private func main() -> Int32 {
  do {
    let rawArguments = Array(CommandLine.arguments.dropFirst())
    let callerDirectory = try currentDirectory()
    _ = umask(0o077)
    try clearInheritedEnvironment()
    try disableCoreDumps()
    let codeIdentity = try validateOwnCodeSignature()
    let homeDirectory = try currentHomeDirectory()
    let parsed = try parseArguments(rawArguments, homeDirectory: homeDirectory)
    let canonicalCallerDirectory = try canonicalExistingPath(
      callerDirectory,
      label: "publisher caller directory"
    )
    let configuration = try loadConfiguration(path: parsed.configPath)
    let trusted = try validateConfiguration(
      configuration,
      homeDirectory: homeDirectory,
      codeIdentity: codeIdentity
    )
    if let ownerRequest = try parseOwnerCapabilityRequest(parsed.forwarded) {
      try requireOwnerAuthorization(
        request: ownerRequest,
        bypassedForTesting: parsed.ownerAuthorizationBypassedForTesting
      )
      guard inheritedEnvironmentNames().isEmpty else {
        throw HostFailure("the inherited environment was repopulated before secret retrieval")
      }
      let ownerProvider: PublisherSecretProvider
      #if TRUSTED_PUBLISHER_HOST_TESTING
        if let fakeSecretPath = parsed.fakeSecretPath {
          ownerProvider = FilePublisherSecretProvider(path: fakeSecretPath)
        } else {
          ownerProvider = KeychainPublisherSecretProvider()
        }
      #else
        ownerProvider = KeychainPublisherSecretProvider()
      #endif
      var ownerSecret = try ownerProvider.readSecret()
      defer { ownerSecret.resetBytes(in: 0..<ownerSecret.count) }
      try validateSecret(ownerSecret)
      let result = try writeOwnerCapability(
        trusted: trusted,
        request: ownerRequest,
        signingKeyData: ownerSecret
      )
      ownerSecret.resetBytes(in: 0..<ownerSecret.count)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      FileHandle.standardOutput.write(try encoder.encode(result) + Data([0x0a]))
      return 0
    }
    let scope = try buildPublisherScope(
      trusted: trusted,
      forwardedArguments: parsed.forwarded,
      callerDirectory: canonicalCallerDirectory,
      homeDirectory: homeDirectory
    )
    guard inheritedEnvironmentNames().isEmpty else {
      throw HostFailure("the inherited environment was repopulated before secret retrieval")
    }

    let provider: PublisherSecretProvider
    #if TRUSTED_PUBLISHER_HOST_TESTING
      if let fakeSecretPath = parsed.fakeSecretPath {
        provider = FilePublisherSecretProvider(path: fakeSecretPath)
      } else {
        provider = KeychainPublisherSecretProvider()
      }
    #else
      provider = KeychainPublisherSecretProvider()
    #endif
    var secret = try provider.readSecret()
    defer { secret.resetBytes(in: 0..<secret.count) }
    try validateSecret(secret)
    let capabilityPath = try writePublisherCapability(
      trusted: trusted,
      scope: scope,
      signingKeyData: secret
    )
    secret.resetBytes(in: 0..<secret.count)
    defer { unlink(capabilityPath) }
    return try runLauncher(
      path: trusted.launcher,
      arguments: parsed.forwarded,
      callerDirectory: canonicalCallerDirectory,
      homeDirectory: homeDirectory,
      configuration: configuration,
      trusted: trusted,
      capabilityPath: capabilityPath
    )
  } catch let failure as HostFailure {
    fputs("trusted-publisher-host: \(failure.description)\n", stderr)
    return 1
  } catch {
    fputs("trusted-publisher-host: an unexpected host validation error occurred\n", stderr)
    return 1
  }
}

exit(main())
