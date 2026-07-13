import CryptoKit
import Darwin
import Foundation
import Security

private let bindingSchemaVersion = 1
private let credentialSchemaVersion = 1
private let bindingPurpose = "automation-actor-launcher"
private let bindingHandoff = "keychain-to-canonical-lease"
private let attestationProtocol = "freed-actor-launcher-readiness-v1"
private let credentialPurpose = "automation-actor-lease"
private let keychainService = "freed-automation-actor"
private let productionBindingRoot =
  "/Library/Application Support/Freed/automation-actor-launchers"
private let productionRuntimeRoot =
  "/Library/Application Support/Freed/automation-actor-runtimes"
private let leaseLifetimeMilliseconds = 30 * 60 * 1_000
private let maximumBindingBytes = 32 * 1_024
private let maximumCredentialBytes = 4 * 1_024
private let randomCredentialBytes = 32
#if AUTOMATION_ACTOR_PROVISION_TESTING
  private let fakeExistingCredential =
    Data("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".utf8)
  private let fakeRotatedCredential =
    Data("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789".utf8)
#endif

private let actorLeaseNames: [String: String] = [
  "freed-runtime-observer": "runtime-observer",
  "freed-stability-controller": "stability-controller",
  "freed-scaffolding-maintainer": "scaffolding-writer",
  "freed-nightly-runner": "nightly-writer",
  "freed-release-verifier": "release-verifier",
]

private struct ProvisionFailure: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

private enum StoreFailure: Error {
  case itemNotFound
  case duplicateItem
  case invalidACL
}

private enum ProvisionAction: String {
  case provision
  case rotate
  case revoke
  case verify
}

private struct ParsedArguments {
  let action: ProvisionAction
  let actor: String
  let stateRoot: String
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    let testBindingPath: String
    let testRuntimeRoot: String
    let testKeychainState: String
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

private struct ActorCredentialRecord: Codable {
  let schemaVersion: Int
  let actor: String
  let purpose: String
  let tokenSha256: String
}

private struct ProvisionResult: Codable {
  let schemaVersion: Int
  let action: String
  let actor: String
  let ready: Bool
  let keychainService: String
  let keychainAccount: String
  let credentialRecordPath: String
}

private struct StoredCredential {
  var secret: Data
  let launcherACLMatches: Bool
}

private protocol SecretStore: AnyObject {
  func read(service: String, account: String, launcherPath: String) throws -> StoredCredential
  func add(service: String, account: String, secret: Data, launcherPath: String) throws
  func update(service: String, account: String, secret: Data, launcherPath: String) throws
  func delete(service: String, account: String) throws
}

private protocol CredentialGenerator {
  func generate() throws -> Data
}

private struct SecureCredentialGenerator: CredentialGenerator {
  func generate() throws -> Data {
    var random = [UInt8](repeating: 0, count: randomCredentialBytes)
    let status = SecRandomCopyBytes(kSecRandomDefault, random.count, &random)
    guard status == errSecSuccess else {
      random.resetBytes(in: 0..<random.count)
      throw ProvisionFailure("the system random source could not create an actor credential")
    }
    let alphabet = Array("0123456789abcdef".utf8)
    var token = [UInt8](repeating: 0, count: random.count * 2)
    for (index, byte) in random.enumerated() {
      token[index * 2] = alphabet[Int(byte >> 4)]
      token[index * 2 + 1] = alphabet[Int(byte & 0x0f)]
    }
    random.resetBytes(in: 0..<random.count)
    let result = Data(token)
    token.resetBytes(in: 0..<token.count)
    return result
  }
}

#if AUTOMATION_ACTOR_PROVISION_TESTING
  private struct FakeCredentialGenerator: CredentialGenerator {
    func generate() throws -> Data {
      fakeRotatedCredential
    }
  }

  private final class FakeSecretStore: SecretStore {
    private var item: StoredCredential?
    private let credentialDirectory: String
    private let injectDigestWriteFailure: Bool
    private var updateCount = 0

    init(state: String, stateRoot: String) throws {
      credentialDirectory = stateRoot + "/control/actor-credentials"
      switch state {
      case "empty":
        item = nil
        injectDigestWriteFailure = false
      case "valid":
        item = StoredCredential(secret: fakeExistingCredential, launcherACLMatches: true)
        injectDigestWriteFailure = false
      case "wrong-secret":
        item = StoredCredential(secret: Data(repeating: 0x66, count: 64), launcherACLMatches: true)
        injectDigestWriteFailure = false
      case "wrong-acl":
        item = StoredCredential(secret: fakeExistingCredential, launcherACLMatches: false)
        injectDigestWriteFailure = false
      case "digest-write-failure":
        item = StoredCredential(secret: fakeExistingCredential, launcherACLMatches: true)
        injectDigestWriteFailure = true
      default:
        throw ProvisionFailure("the fake Keychain state is unsupported")
      }
    }

    func read(service: String, account: String, launcherPath: String) throws -> StoredCredential {
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/"
      else {
        throw ProvisionFailure("the fake Keychain read was not canonical")
      }
      guard let item else { throw StoreFailure.itemNotFound }
      return item
    }

    func add(service: String, account: String, secret: Data, launcherPath: String) throws {
      guard item == nil else { throw StoreFailure.duplicateItem }
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/", secret == fakeRotatedCredential
      else {
        throw ProvisionFailure("the fake Keychain add was not canonical")
      }
      item = StoredCredential(secret: secret, launcherACLMatches: true)
    }

    func update(service: String, account: String, secret: Data, launcherPath: String) throws {
      guard item != nil else { throw StoreFailure.itemNotFound }
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/"
      else {
        throw ProvisionFailure("the fake Keychain update was not canonical")
      }
      updateCount += 1
      if injectDigestWriteFailure {
        let mode: mode_t = updateCount == 1 ? 0o500 : 0o700
        guard chmod(credentialDirectory, mode) == 0 else {
          throw posixFailure("injecting an actor credential record write failure")
        }
      }
      item = StoredCredential(secret: secret, launcherACLMatches: true)
    }

    func delete(service: String, account: String) throws {
      guard service == keychainService, actorLeaseNames[account] != nil else {
        throw ProvisionFailure("the fake Keychain deletion was not canonical")
      }
      guard item != nil else { throw StoreFailure.itemNotFound }
      item = nil
    }
  }
#endif

private final class KeychainSecretStore: SecretStore {
  private func identityQuery(service: String, account: String) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
    ]
  }

  private func trustedApplication(_ launcherPath: String) throws -> SecTrustedApplication {
    var application: SecTrustedApplication?
    let status = launcherPath.withCString { pointer in
      SecTrustedApplicationCreateFromPath(pointer, &application)
    }
    guard status == errSecSuccess, let application else {
      throw ProvisionFailure("the launcher Keychain identity could not be created")
    }
    return application
  }

  private func access(_ launcherPath: String, account: String) throws -> SecAccess {
    let application = try trustedApplication(launcherPath)
    var access: SecAccess?
    let trustedList = [application] as CFArray
    let status = SecAccessCreate(
      "Freed automation actor \(account)" as CFString,
      trustedList,
      &access
    )
    guard status == errSecSuccess, let access else {
      throw ProvisionFailure("the launcher-only Keychain ACL could not be created")
    }
    return access
  }

  private func copyItemReference(service: String, account: String) throws -> SecKeychainItem {
    var query = identityQuery(service: service, account: account)
    query[kSecReturnRef] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { throw StoreFailure.itemNotFound }
    guard status == errSecSuccess, let item = result as! SecKeychainItem? else {
      throw ProvisionFailure("the actor Keychain item reference is unavailable")
    }
    return item
  }

  private func trustedApplicationData(_ application: SecTrustedApplication) throws -> Data {
    var data: CFData?
    let status = SecTrustedApplicationCopyData(application, &data)
    guard status == errSecSuccess, let data else {
      throw ProvisionFailure("a Keychain trusted application identity is unreadable")
    }
    return data as Data
  }

  private func aclMatches(
    service: String,
    account: String,
    launcherPath: String
  ) throws -> Bool {
    let item = try copyItemReference(service: service, account: account)
    var itemAccess: SecAccess?
    guard SecKeychainItemCopyAccess(item, &itemAccess) == errSecSuccess,
      let itemAccess
    else {
      throw ProvisionFailure("the actor Keychain ACL is unavailable")
    }
    let expectedApplication = try trustedApplication(launcherPath)
    let expectedData = try trustedApplicationData(expectedApplication)
    guard let aclList = SecAccessCopyMatchingACLList(
      itemAccess,
      kSecACLAuthorizationDecrypt
    ) as? [SecACL], !aclList.isEmpty else {
      return false
    }
    for acl in aclList {
      var applications: CFArray?
      var description: CFString?
      var selector = SecKeychainPromptSelector()
      guard SecACLCopyContents(acl, &applications, &description, &selector) == errSecSuccess,
        let trustedApplications = applications as? [SecTrustedApplication],
        trustedApplications.count == 1,
        try trustedApplicationData(trustedApplications[0]) == expectedData
      else {
        return false
      }
    }
    return true
  }

  func read(service: String, account: String, launcherPath: String) throws -> StoredCredential {
    var query = identityQuery(service: service, account: account)
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { throw StoreFailure.itemNotFound }
    guard status == errSecSuccess, let data = result as? Data else {
      throw ProvisionFailure("the actor Keychain credential could not be read")
    }
    return StoredCredential(
      secret: data,
      launcherACLMatches: try aclMatches(
        service: service,
        account: account,
        launcherPath: launcherPath
      )
    )
  }

  func add(service: String, account: String, secret: Data, launcherPath: String) throws {
    var attributes = identityQuery(service: service, account: account)
    attributes[kSecAttrLabel] = "Freed automation actor \(account)"
    attributes[kSecValueData] = secret
    attributes[kSecAttrAccess] = try access(launcherPath, account: account)
    let status = SecItemAdd(attributes as CFDictionary, nil)
    if status == errSecDuplicateItem { throw StoreFailure.duplicateItem }
    guard status == errSecSuccess else {
      throw ProvisionFailure("the actor Keychain credential could not be created")
    }
  }

  func update(service: String, account: String, secret: Data, launcherPath: String) throws {
    let query = identityQuery(service: service, account: account)
    let status = SecItemUpdate(
      query as CFDictionary,
      [kSecValueData: secret] as CFDictionary
    )
    if status == errSecItemNotFound { throw StoreFailure.itemNotFound }
    guard status == errSecSuccess else {
      throw ProvisionFailure("the actor Keychain credential could not be rotated")
    }
    let item = try copyItemReference(service: service, account: account)
    guard SecKeychainItemSetAccess(item, try access(launcherPath, account: account)) == errSecSuccess else {
      throw ProvisionFailure("the rotated actor Keychain ACL could not be constrained")
    }
  }

  func delete(service: String, account: String) throws {
    let status = SecItemDelete(identityQuery(service: service, account: account) as CFDictionary)
    if status == errSecItemNotFound { throw StoreFailure.itemNotFound }
    guard status == errSecSuccess else {
      throw ProvisionFailure("the actor Keychain credential could not be revoked")
    }
  }
}

private func posixFailure(_ operation: String, code: Int32 = errno) -> ProvisionFailure {
  ProvisionFailure("\(operation) failed with errno \(code)")
}

private func disableCoreDumps() throws {
  var limit = rlimit(rlim_cur: 0, rlim_max: 0)
  guard setrlimit(RLIMIT_CORE, &limit) == 0 else {
    throw posixFailure("disabling actor provisioner core dumps")
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
      throw posixFailure("clearing inherited actor provisioner state")
    }
  }
  guard inheritedEnvironmentNames().isEmpty else {
    throw ProvisionFailure("the inherited actor provisioner environment could not be cleared")
  }
}

private func parseArguments(_ values: [String]) throws -> ParsedArguments {
  guard let first = values.first, let action = ProvisionAction(rawValue: first) else {
    throw ProvisionFailure("the provisioner requires provision, rotate, revoke, or verify")
  }
  var options: [String: String] = [:]
  var allowed = Set(["--actor", "--state-root"])
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    allowed.insert("--test-binding")
    allowed.insert("--test-runtime-root")
    allowed.insert("--test-keychain-state")
  #endif
  var index = 1
  while index < values.count {
    let option = values[index]
    guard allowed.contains(option), index + 1 < values.count,
      options[option] == nil
    else {
      throw ProvisionFailure("the actor provisioner received an unsupported or duplicate argument")
    }
    options[option] = values[index + 1]
    index += 2
  }
  guard let actor = options["--actor"],
    let stateRoot = options["--state-root"],
    actorLeaseNames[actor] != nil
  else {
    throw ProvisionFailure("the provisioner requires one supported general automation actor")
  }
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    guard let testBindingPath = options["--test-binding"],
      let testRuntimeRoot = options["--test-runtime-root"],
      let testKeychainState = options["--test-keychain-state"]
    else {
      throw ProvisionFailure("the provisioner test fixture is incomplete")
    }
    return ParsedArguments(
      action: action,
      actor: actor,
      stateRoot: stateRoot,
      testBindingPath: testBindingPath,
      testRuntimeRoot: testRuntimeRoot,
      testKeychainState: testKeychainState
    )
  #else
    return ParsedArguments(action: action, actor: actor, stateRoot: stateRoot)
  #endif
}

private func canonicalExistingPath(_ path: String, label: String) throws -> String {
  guard path.first == "/", !path.contains("\n"), !path.contains("\0") else {
    throw ProvisionFailure("\(label) must be an absolute path without control characters")
  }
  guard let pointer = realpath(path, nil) else {
    throw ProvisionFailure("\(label) cannot be resolved")
  }
  defer { free(pointer) }
  let resolved = String(cString: pointer)
  guard resolved == path else {
    throw ProvisionFailure("\(label) must already be a physical canonical path")
  }
  return resolved
}

private func metadata(_ path: String) throws -> stat {
  var value = stat()
  guard lstat(path, &value) == 0 else {
    throw ProvisionFailure("a trusted actor provisioner path is unavailable")
  }
  return value
}

private func trustedOwners() -> Set<uid_t> {
  #if AUTOMATION_ACTOR_PROVISION_TESTING
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
      throw ProvisionFailure("\(label) must have a trusted immutable physical directory hierarchy")
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
    throw ProvisionFailure("\(label) must be a trusted immutable regular file")
  }
  try requireTrustedHierarchy(URL(fileURLWithPath: path).deletingLastPathComponent().path, label: label)
}

private func requireOwnerDirectory(_ path: String, label: String) throws {
  _ = try canonicalExistingPath(path, label: label)
  let value = try metadata(path)
  guard value.st_mode & S_IFMT == S_IFDIR, value.st_uid == getuid(),
    value.st_mode & 0o077 == 0
  else {
    throw ProvisionFailure("\(label) must be a private physical directory owned by the current user")
  }
}

private func ensureOwnerDirectory(_ path: String, label: String) throws {
  if mkdir(path, 0o700) != 0, errno != EEXIST {
    throw posixFailure("creating \(label)")
  }
  try requireOwnerDirectory(path, label: label)
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
  _ = try canonicalExistingPath(path, label: "actor provisioner file")
  let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw ProvisionFailure("an actor provisioner file cannot be opened")
  }
  defer { close(descriptor) }
  var value = stat()
  guard fstat(descriptor, &value) == 0,
    value.st_mode & S_IFMT == S_IFREG,
    allowedOwners.contains(value.st_uid),
    value.st_size >= 0,
    value.st_size <= maximumBytes
  else {
    throw ProvisionFailure("an actor provisioner file has an invalid owner, type, or size")
  }
  if let requiredMode {
    guard value.st_mode & 0o777 == requiredMode else {
      throw ProvisionFailure("an actor provisioner file has invalid permissions")
    }
  } else if value.st_mode & 0o022 != 0 {
    throw ProvisionFailure("an actor provisioner file is group or world writable")
  }
  var data = Data()
  var buffer = [UInt8](repeating: 0, count: min(maximumBytes + 1, 16 * 1_024))
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count == 0 { break }
    if count < 0 {
      if errno == EINTR { continue }
      throw posixFailure("reading an actor provisioner file")
    }
    guard data.count + count <= maximumBytes else {
      throw ProvisionFailure("an actor provisioner file exceeds its size limit")
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
    throw ProvisionFailure("a pinned actor provisioner file cannot be opened")
  }
  defer { close(descriptor) }
  var digest = SHA256()
  var buffer = [UInt8](repeating: 0, count: 1_024 * 1_024)
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count == 0 { break }
    if count < 0 {
      if errno == EINTR { continue }
      throw posixFailure("hashing a pinned actor provisioner file")
    }
    digest.update(data: Data(buffer[0..<count]))
  }
  buffer.resetBytes(in: 0..<buffer.count)
  return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func requireLowercaseHex(_ value: String, length: Int, label: String) throws {
  let bytes = Array(value.utf8)
  guard bytes.count == length,
    bytes.allSatisfy({ byte in
      (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
    })
  else {
    throw ProvisionFailure("\(label) must contain \(length) lowercase hexadecimal characters")
  }
}

private func decodeStrict<T: Decodable>(
  _ type: T.Type,
  data: Data,
  expectedKeys: Set<String>,
  label: String
) throws -> T {
  let value = try JSONSerialization.jsonObject(with: data)
  guard let dictionary = value as? [String: Any], Set(dictionary.keys) == expectedKeys else {
    throw ProvisionFailure("\(label) has an unsupported shape")
  }
  do {
    return try JSONDecoder().decode(type, from: data)
  } catch {
    throw ProvisionFailure("\(label) is not valid JSON")
  }
}

private func bindingPath(_ arguments: ParsedArguments) -> String {
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    return arguments.testBindingPath
  #else
    return productionBindingRoot + "/" + arguments.actor + ".json"
  #endif
}

private func runtimeRoot(_ arguments: ParsedArguments) -> String {
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    return arguments.testRuntimeRoot
  #else
    return productionRuntimeRoot
  #endif
}

private func loadAndValidateBinding(_ arguments: ParsedArguments) throws -> LauncherBinding {
  let path = bindingPath(arguments)
  let canonicalBindingRoot = URL(fileURLWithPath: path).deletingLastPathComponent().path
  guard path == canonicalBindingRoot + "/" + arguments.actor + ".json" else {
    throw ProvisionFailure("the actor launcher binding path is not canonical")
  }
  #if !AUTOMATION_ACTOR_PROVISION_TESTING
    guard canonicalBindingRoot == productionBindingRoot else {
      throw ProvisionFailure("the actor launcher binding root is not canonical")
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
    binding.leaseName == actorLeaseNames[arguments.actor],
    binding.maxLeaseLifetimeMs == leaseLifetimeMilliseconds,
    binding.keychainService == keychainService,
    binding.keychainAccount == arguments.actor
  else {
    throw ProvisionFailure("the actor launcher binding does not match this request")
  }
  try requireLowercaseHex(binding.launcherSha256, length: 64, label: "launcher digest")
  try requireLowercaseHex(binding.nodeSha256, length: 64, label: "Node digest")
  try requireLowercaseHex(binding.controlEntrySha256, length: 64, label: "control entry digest")
  try requireLowercaseHex(binding.controlLibrarySha256, length: 64, label: "control library digest")

  let expectedLauncherPath =
    canonicalBindingRoot + "/bin/" + binding.actor + "-" + binding.launcherSha256
  guard binding.launcherPath == expectedLauncherPath else {
    throw ProvisionFailure("the actor host does not use the canonical content-addressed path")
  }
  try requireTrustedFile(binding.launcherPath, executable: true, label: "actor host executable")
  guard try sha256ForFile(binding.launcherPath) == binding.launcherSha256 else {
    throw ProvisionFailure("the actor host executable does not match its pinned digest")
  }
  let canonicalRuntimeRoot = try canonicalExistingPath(runtimeRoot(arguments), label: "actor runtime root")
  try requireTrustedHierarchy(canonicalRuntimeRoot, label: "actor runtime root")
  let expectedRuntimeDirectory = canonicalRuntimeRoot + "/" + runtimeDigest(binding)
  guard binding.nodePath == expectedRuntimeDirectory + "/node",
    binding.controlEntryPath == expectedRuntimeDirectory + "/automation-control.mjs",
    binding.controlLibraryPath == expectedRuntimeDirectory + "/lib/automation-control.mjs"
  else {
    throw ProvisionFailure("the pinned actor runtime does not use the canonical content-addressed layout")
  }
  let runtimePins = [
    (binding.nodePath, binding.nodeSha256, true, "Node runtime"),
    (binding.controlEntryPath, binding.controlEntrySha256, false, "automation control entry"),
    (binding.controlLibraryPath, binding.controlLibrarySha256, false, "automation control library"),
  ]
  for (runtimePath, digest, executable, label) in runtimePins {
    let canonical = try canonicalExistingPath(runtimePath, label: label)
    guard isStrictChild(canonical, of: canonicalRuntimeRoot) else {
      throw ProvisionFailure("\(label) must be a strict child of the actor runtime root")
    }
    try requireTrustedFile(canonical, executable: executable, label: label)
    guard try sha256ForFile(canonical) == digest else {
      throw ProvisionFailure("\(label) does not match its pinned digest")
    }
  }
  let canonicalStateRoot = try canonicalExistingPath(arguments.stateRoot, label: "automation state root")
  guard binding.stateRoot == canonicalStateRoot else {
    throw ProvisionFailure("the automation state root is not canonical")
  }
  try requireOwnerDirectory(canonicalStateRoot, label: "automation state root")
  return binding
}

private func credentialDirectory(for binding: LauncherBinding) -> String {
  binding.stateRoot + "/control/actor-credentials"
}

private func credentialPath(for binding: LauncherBinding) -> String {
  credentialDirectory(for: binding) + "/" + binding.actor + ".json"
}

private func ensureCredentialDirectory(for binding: LauncherBinding) throws {
  let controlDirectory = binding.stateRoot + "/control"
  try ensureOwnerDirectory(controlDirectory, label: "automation control directory")
  try ensureOwnerDirectory(
    credentialDirectory(for: binding),
    label: "actor credential directory"
  )
}

private func fileExists(_ path: String) -> Bool {
  var value = stat()
  return lstat(path, &value) == 0
}

private func readCredentialIfPresent(_ binding: LauncherBinding) throws -> ActorCredentialRecord? {
  let path = credentialPath(for: binding)
  if !fileExists(path) { return nil }
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
    throw ProvisionFailure("the actor credential record identity is invalid")
  }
  try requireLowercaseHex(credential.tokenSha256, length: 64, label: "actor credential digest")
  return credential
}

private func writeAll(_ descriptor: Int32, data: Data) throws {
  try data.withUnsafeBytes { rawBuffer in
    guard let base = rawBuffer.baseAddress else { return }
    var offset = 0
    while offset < data.count {
      let count = Darwin.write(descriptor, base.advanced(by: offset), data.count - offset)
      if count < 0 {
        if errno == EINTR { continue }
        throw posixFailure("writing the actor credential record")
      }
      offset += count
    }
  }
}

private func syncDirectory(_ path: String) throws {
  let descriptor = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
  guard descriptor >= 0 else {
    throw ProvisionFailure("the actor credential directory cannot be synchronized")
  }
  defer { close(descriptor) }
  guard fsync(descriptor) == 0 else {
    throw posixFailure("synchronizing the actor credential directory")
  }
}

private func writeCredentialAtomic(_ record: ActorCredentialRecord, binding: LauncherBinding) throws {
  let directory = credentialDirectory(for: binding)
  let destination = credentialPath(for: binding)
  let temporary = directory + "/." + binding.actor + "." + UUID().uuidString + ".tmp"
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  var data = try encoder.encode(record)
  data.append(0x0A)
  let descriptor = open(
    temporary,
    O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    0o600
  )
  guard descriptor >= 0 else {
    throw ProvisionFailure("the temporary actor credential record cannot be created")
  }
  var completed = false
  defer {
    close(descriptor)
    if !completed { unlink(temporary) }
    data.resetBytes(in: 0..<data.count)
  }
  try writeAll(descriptor, data: data)
  guard fsync(descriptor) == 0 else {
    throw posixFailure("synchronizing the actor credential record")
  }
  guard rename(temporary, destination) == 0 else {
    throw posixFailure("installing the actor credential record")
  }
  completed = true
  try syncDirectory(directory)
}

private func removeCredentialIfPresent(_ binding: LauncherBinding) throws {
  let path = credentialPath(for: binding)
  if unlink(path) != 0, errno != ENOENT {
    throw posixFailure("removing the actor credential record")
  }
  if fileExists(credentialDirectory(for: binding)) {
    try syncDirectory(credentialDirectory(for: binding))
  }
}

private func validateStoredCredential(
  _ stored: StoredCredential,
  record: ActorCredentialRecord
) throws {
  defer {
    var secret = stored.secret
    secret.resetBytes(in: 0..<secret.count)
  }
  guard stored.launcherACLMatches else {
    throw ProvisionFailure("the actor Keychain item is not constrained to the exact launcher")
  }
  guard stored.secret.count >= 32,
    sha256Hex(stored.secret) == record.tokenSha256
  else {
    throw ProvisionFailure("the actor Keychain credential does not match the owner-held digest")
  }
}

private func keychainItemExists(
  store: SecretStore,
  binding: LauncherBinding
) throws -> Bool {
  do {
    var stored = try store.read(
      service: binding.keychainService,
      account: binding.keychainAccount,
      launcherPath: binding.launcherPath
    )
    stored.secret.resetBytes(in: 0..<stored.secret.count)
    return true
  } catch StoreFailure.itemNotFound {
    return false
  }
}

private func provision(
  binding: LauncherBinding,
  store: SecretStore,
  generator: CredentialGenerator
) throws {
  try ensureCredentialDirectory(for: binding)
  let recordExists = try readCredentialIfPresent(binding) != nil
  let itemExists = try keychainItemExists(store: store, binding: binding)
  guard !recordExists, !itemExists else {
    throw ProvisionFailure(
      "an existing or partial actor credential was found; run revoke, then retry provision"
    )
  }
  var secret = try generator.generate()
  defer { secret.resetBytes(in: 0..<secret.count) }
  try store.add(
    service: binding.keychainService,
    account: binding.keychainAccount,
    secret: secret,
    launcherPath: binding.launcherPath
  )
  do {
    try writeCredentialAtomic(
      ActorCredentialRecord(
        schemaVersion: credentialSchemaVersion,
        actor: binding.actor,
        purpose: credentialPurpose,
        tokenSha256: sha256Hex(secret)
      ),
      binding: binding
    )
  } catch {
    do {
      do {
        try store.delete(service: binding.keychainService, account: binding.keychainAccount)
      } catch StoreFailure.itemNotFound {
      }
      try removeCredentialIfPresent(binding)
    } catch {
      throw ProvisionFailure(
        "actor credential provisioning failed and its partial state could not be revoked"
      )
    }
    throw ProvisionFailure(
      "actor credential provisioning failed while installing the digest; partial state was revoked"
    )
  }
}

private func rotate(
  binding: LauncherBinding,
  store: SecretStore,
  generator: CredentialGenerator
) throws {
  try ensureCredentialDirectory(for: binding)
  guard let record = try readCredentialIfPresent(binding) else {
    throw ProvisionFailure("the actor credential record is missing")
  }
  var previous = try store.read(
    service: binding.keychainService,
    account: binding.keychainAccount,
    launcherPath: binding.launcherPath
  )
  defer { previous.secret.resetBytes(in: 0..<previous.secret.count) }
  try validateStoredCredential(previous, record: record)
  var secret = try generator.generate()
  defer { secret.resetBytes(in: 0..<secret.count) }
  do {
    try store.update(
      service: binding.keychainService,
      account: binding.keychainAccount,
      secret: secret,
      launcherPath: binding.launcherPath
    )
  } catch {
    do {
      try store.update(
        service: binding.keychainService,
        account: binding.keychainAccount,
        secret: previous.secret,
        launcherPath: binding.launcherPath
      )
    } catch {
      throw ProvisionFailure(
        "actor credential rotation failed and the previous Keychain value could not be restored"
      )
    }
    throw ProvisionFailure(
      "actor credential rotation failed before the digest changed; the previous credential was restored"
    )
  }
  do {
    try writeCredentialAtomic(
      ActorCredentialRecord(
        schemaVersion: credentialSchemaVersion,
        actor: binding.actor,
        purpose: credentialPurpose,
        tokenSha256: sha256Hex(secret)
      ),
      binding: binding
    )
  } catch {
    do {
      try store.update(
        service: binding.keychainService,
        account: binding.keychainAccount,
        secret: previous.secret,
        launcherPath: binding.launcherPath
      )
      try writeCredentialAtomic(record, binding: binding)
    } catch {
      throw ProvisionFailure(
        "actor credential rotation failed and the prior Keychain value or digest record could not be restored"
      )
    }
    throw ProvisionFailure(
      "actor credential rotation failed while installing the digest; the previous credential was restored"
    )
  }
}

private func revoke(binding: LauncherBinding, store: SecretStore) throws {
  do {
    try store.delete(service: binding.keychainService, account: binding.keychainAccount)
  } catch StoreFailure.itemNotFound {
  }
  try removeCredentialIfPresent(binding)
}

private func verify(binding: LauncherBinding, store: SecretStore) throws {
  guard let record = try readCredentialIfPresent(binding) else {
    throw ProvisionFailure("the actor credential record is missing")
  }
  var stored = try store.read(
    service: binding.keychainService,
    account: binding.keychainAccount,
    launcherPath: binding.launcherPath
  )
  defer { stored.secret.resetBytes(in: 0..<stored.secret.count) }
  try validateStoredCredential(stored, record: record)
}

private func writeResult(_ action: ProvisionAction, binding: LauncherBinding, ready: Bool) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  let result = ProvisionResult(
    schemaVersion: 1,
    action: action.rawValue,
    actor: binding.actor,
    ready: ready,
    keychainService: binding.keychainService,
    keychainAccount: binding.keychainAccount,
    credentialRecordPath: credentialPath(for: binding)
  )
  FileHandle.standardOutput.write(try encoder.encode(result))
  FileHandle.standardOutput.write(Data([0x0A]))
}

private func main() throws {
  let arguments = try parseArguments(Array(CommandLine.arguments.dropFirst()))
  #if !AUTOMATION_ACTOR_PROVISION_TESTING
    guard getuid() != 0, geteuid() != 0 else {
      throw ProvisionFailure("the actor provisioner must run as the target non-root user")
    }
  #endif
  _ = umask(0o077)
  try disableCoreDumps()
  try clearInheritedEnvironment()
  let binding = try loadAndValidateBinding(arguments)
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    let store: SecretStore = try FakeSecretStore(
      state: arguments.testKeychainState,
      stateRoot: arguments.stateRoot
    )
    let generator: CredentialGenerator = FakeCredentialGenerator()
  #else
    let store: SecretStore = KeychainSecretStore()
    let generator: CredentialGenerator = SecureCredentialGenerator()
  #endif
  switch arguments.action {
  case .provision:
    try provision(binding: binding, store: store, generator: generator)
    try writeResult(arguments.action, binding: binding, ready: true)
  case .rotate:
    try rotate(binding: binding, store: store, generator: generator)
    try writeResult(arguments.action, binding: binding, ready: true)
  case .revoke:
    try revoke(binding: binding, store: store)
    try writeResult(arguments.action, binding: binding, ready: false)
  case .verify:
    try verify(binding: binding, store: store)
    try writeResult(arguments.action, binding: binding, ready: true)
  }
}

do {
  try main()
} catch let failure as ProvisionFailure {
  fputs("automation-actor-provision: \(failure.description)\n", stderr)
  exit(1)
} catch StoreFailure.itemNotFound {
  fputs("automation-actor-provision: the actor Keychain credential is missing\n", stderr)
  exit(1)
} catch StoreFailure.duplicateItem {
  fputs("automation-actor-provision: the actor Keychain credential already exists\n", stderr)
  exit(1)
} catch StoreFailure.invalidACL {
  fputs("automation-actor-provision: the actor Keychain ACL is invalid\n", stderr)
  exit(1)
} catch {
  fputs("automation-actor-provision: an unexpected provisioning error occurred\n", stderr)
  exit(1)
}
