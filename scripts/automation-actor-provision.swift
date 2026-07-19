import CryptoKit
import Darwin
import Foundation
import Security

private let bindingSchemaVersion = 2
private let credentialSchemaVersion = 1
private let bindingPurpose = "automation-actor-launcher"
private let bindingHandoff = "keychain-to-canonical-lease"
private let attestationProtocol = "freed-actor-launcher-readiness-v2"
private let legacyAttestationProtocol = "freed-actor-launcher-readiness-v1"
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
// The trusted application list already limits decryption to the exact
// root-owned launcher. Requiring a passphrase for unsigned or invalid callers
// would force a dialog for our deterministic ad hoc signed launcher.
private let launcherPromptSelector = SecKeychainPromptSelector()
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
}

private enum ProvisionAction: String {
  case provision
  case rotate
  case revoke
}

private struct ParsedArguments {
  let action: ProvisionAction
  let actor: String
  let stateRoot: String
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    let testBindingPath: String
    let testRuntimeRoot: String
    let testKeychainState: String
    let testInteractionMode: String
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
  let leaseArchiveHelperPath: String
  let leaseArchiveHelperSha256: String
}

private struct ActorCredentialRecord: Codable, Equatable {
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

private struct StoredCredentialMetadata {
  let launcherACLMatches: Bool
}

private enum CreatedCredentialHandle {
  case system(Data)
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    case fake(UUID)
  #endif
}

private struct ProvisionRollback {
  let createdItem: CreatedCredentialHandle
  let record: ActorCredentialRecord
}

private protocol SecretStore: AnyObject {
  func inspect(
    service: String,
    account: String,
    launcherPath: String
  ) throws -> StoredCredentialMetadata
  func readOwnerInteractive(
    service: String,
    account: String,
    launcherPath: String
  ) throws -> StoredCredential
  func add(
    service: String,
    account: String,
    secret: Data,
    launcherPath: String
  ) throws -> CreatedCredentialHandle
  func deleteCreated(_ handle: CreatedCredentialHandle) throws
  func update(service: String, account: String, secret: Data, launcherPath: String) throws
  func delete(service: String, account: String) throws
}

private protocol CredentialGenerator {
  func generate() throws -> Data
}

private protocol KeychainInteractionController: AnyObject {
  func currentState() throws -> Bool
  func setAllowed(_ allowed: Bool) throws
}

private final class SystemKeychainInteractionController: KeychainInteractionController {
  func currentState() throws -> Bool {
    var state = DarwinBoolean(false)
    guard SecKeychainGetUserInteractionAllowed(&state) == errSecSuccess else {
      throw ProvisionFailure("the Keychain interaction policy could not be read")
    }
    return state.boolValue
  }

  func setAllowed(_ allowed: Bool) throws {
    guard SecKeychainSetUserInteractionAllowed(allowed) == errSecSuccess else {
      throw ProvisionFailure("the Keychain interaction policy could not be changed")
    }
  }
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
  private final class FakeKeychainInteractionController: KeychainInteractionController {
    private let mode: String
    private let credentialRecordPath: String
    private let actor: String
    private(set) var interactionAllowed: Bool

    init(mode: String, stateRoot: String, actor: String) {
      self.mode = mode
      credentialRecordPath = stateRoot + "/control/actor-credentials/" + actor + ".json"
      self.actor = actor
      interactionAllowed = mode != "initially-disabled"
    }

    private func injectCredentialDigestDrift() throws {
      let record = ActorCredentialRecord(
        schemaVersion: credentialSchemaVersion,
        actor: actor,
        purpose: credentialPurpose,
        tokenSha256: String(repeating: "0", count: 64)
      )
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      var data = try encoder.encode(record)
      defer { data.resetBytes(in: 0..<data.count) }
      data.append(0x0A)
      try data.write(to: URL(fileURLWithPath: credentialRecordPath), options: .atomic)
      guard chmod(credentialRecordPath, 0o600) == 0 else {
        throw posixFailure("securing the drifted fake credential record")
      }
    }

    func currentState() throws -> Bool {
      if mode == "get-failure" {
        throw ProvisionFailure("the test Keychain interaction policy could not be read")
      }
      return interactionAllowed
    }

    func setAllowed(_ allowed: Bool) throws {
      if !allowed, mode == "disable-failure" {
        throw ProvisionFailure("the test Keychain interaction policy could not be disabled")
      }
      if !allowed, mode == "disable-noop" {
        return
      }
      if allowed, mode == "restore-failure-with-digest-drift" {
        try injectCredentialDigestDrift()
        throw ProvisionFailure("the test Keychain interaction policy could not be restored")
      }
      if allowed, mode == "restore-failure" {
        throw ProvisionFailure("the test Keychain interaction policy could not be restored")
      }
      interactionAllowed = allowed
    }
  }

  private struct FakeCredentialGenerator: CredentialGenerator {
    func generate() throws -> Data {
      fakeRotatedCredential
    }
  }

  private struct FakeKeychainItemSnapshot: Codable {
    let present: Bool
    let secretSha256: String?
    let launcherACLMatches: Bool?
  }

  private final class FakeSecretStore: SecretStore {
    private var item: StoredCredential?
    private var itemIdentity: UUID?
    private let credentialDirectory: String
    private let itemSnapshotPath: String
    private let injectDigestWriteFailure: Bool
    private let injectPartialRotationFailure: Bool
    private let rejectSecretReads: Bool
    private let interactionController: FakeKeychainInteractionController
    private var updateCount = 0

    init(
      state: String,
      stateRoot: String,
      interactionController: FakeKeychainInteractionController
    ) throws {
      credentialDirectory = stateRoot + "/control/actor-credentials"
      itemSnapshotPath = stateRoot + "/test-keychain-item.json"
      self.interactionController = interactionController
      injectDigestWriteFailure = state == "digest-write-failure"
      injectPartialRotationFailure = state == "partial-rotation-failure"
      rejectSecretReads = state == "metadata-only"
      switch state {
      case "empty":
        item = nil
      case "valid", "digest-write-failure", "metadata-only", "partial-rotation-failure":
        item = StoredCredential(secret: fakeExistingCredential, launcherACLMatches: true)
      case "wrong-secret":
        item = StoredCredential(secret: Data(repeating: 0x66, count: 64), launcherACLMatches: true)
      case "wrong-acl":
        item = StoredCredential(secret: fakeExistingCredential, launcherACLMatches: false)
      default:
        throw ProvisionFailure("the fake Keychain state is unsupported")
      }
      itemIdentity = item == nil ? nil : UUID()
      try persistItemSnapshot()
    }

    private func persistItemSnapshot() throws {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      let snapshot = FakeKeychainItemSnapshot(
        present: item != nil,
        secretSha256: item.map { sha256Hex($0.secret) },
        launcherACLMatches: item.map(\.launcherACLMatches)
      )
      var data = try encoder.encode(snapshot)
      data.append(0x0A)
      try data.write(to: URL(fileURLWithPath: itemSnapshotPath), options: .atomic)
      data.resetBytes(in: 0..<data.count)
      guard chmod(itemSnapshotPath, 0o600) == 0 else {
        throw posixFailure("securing the fake Keychain item snapshot")
      }
    }

    func inspect(
      service: String,
      account: String,
      launcherPath: String
    ) throws -> StoredCredentialMetadata {
      guard !interactionController.interactionAllowed else {
        throw ProvisionFailure("the fake Keychain inspection permitted user interaction")
      }
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/"
      else {
        throw ProvisionFailure("the fake Keychain inspection was not canonical")
      }
      guard let item else { throw StoreFailure.itemNotFound }
      return StoredCredentialMetadata(launcherACLMatches: item.launcherACLMatches)
    }

    func readOwnerInteractive(
      service: String,
      account: String,
      launcherPath: String
    ) throws -> StoredCredential {
      guard interactionController.interactionAllowed else {
        throw ProvisionFailure("the fake owner-interactive Keychain read suppressed interaction")
      }
      guard !rejectSecretReads else {
        throw ProvisionFailure("the fake Keychain secret read was forbidden")
      }
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/"
      else {
        throw ProvisionFailure("the fake Keychain read was not canonical")
      }
      guard let item else { throw StoreFailure.itemNotFound }
      return item
    }

    func add(
      service: String,
      account: String,
      secret: Data,
      launcherPath: String
    ) throws -> CreatedCredentialHandle {
      guard !interactionController.interactionAllowed else {
        throw ProvisionFailure("the fake Keychain add permitted user interaction")
      }
      guard item == nil else { throw StoreFailure.duplicateItem }
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/", secret == fakeRotatedCredential
      else {
        throw ProvisionFailure("the fake Keychain add was not canonical")
      }
      let identity = UUID()
      item = StoredCredential(secret: secret, launcherACLMatches: true)
      itemIdentity = identity
      try persistItemSnapshot()
      return .fake(identity)
    }

    func deleteCreated(_ handle: CreatedCredentialHandle) throws {
      guard !interactionController.interactionAllowed else {
        throw ProvisionFailure("the fake Keychain rollback permitted user interaction")
      }
      guard case .fake(let identity) = handle, itemIdentity == identity, item != nil else {
        throw ProvisionFailure("the fake Keychain rollback did not match the created item")
      }
      item = nil
      itemIdentity = nil
      try persistItemSnapshot()
    }

    func update(service: String, account: String, secret: Data, launcherPath: String) throws {
      guard interactionController.interactionAllowed else {
        throw ProvisionFailure("the fake owner-interactive Keychain update suppressed interaction")
      }
      guard item != nil else { throw StoreFailure.itemNotFound }
      guard service == keychainService, actorLeaseNames[account] != nil,
        launcherPath.first == "/"
      else {
        throw ProvisionFailure("the fake Keychain update was not canonical")
      }
      updateCount += 1
      if injectPartialRotationFailure, updateCount == 1 {
        let previousACL = item?.launcherACLMatches ?? false
        item = StoredCredential(secret: secret, launcherACLMatches: previousACL)
        try persistItemSnapshot()
        throw ProvisionFailure(
          "the fake Keychain rotation failed after changing the secret and before applying the ACL"
        )
      }
      if injectDigestWriteFailure {
        let mode: mode_t = updateCount == 1 ? 0o500 : 0o700
        guard chmod(credentialDirectory, mode) == 0 else {
          throw posixFailure("injecting an actor credential record write failure")
        }
      }
      item = StoredCredential(secret: secret, launcherACLMatches: true)
      try persistItemSnapshot()
    }

    func delete(service: String, account: String) throws {
      guard !interactionController.interactionAllowed else {
        throw ProvisionFailure("the fake Keychain deletion permitted user interaction")
      }
      guard service == keychainService, actorLeaseNames[account] != nil else {
        throw ProvisionFailure("the fake Keychain deletion was not canonical")
      }
      guard item != nil else { throw StoreFailure.itemNotFound }
      item = nil
      itemIdentity = nil
      try persistItemSnapshot()
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
    let description = "Freed automation actor \(account)" as CFString
    let status = SecAccessCreate(
      description,
      trustedList,
      &access
    )
    guard status == errSecSuccess, let access else {
      throw ProvisionFailure("the launcher-only Keychain ACL could not be created")
    }
    guard let aclList = SecAccessCopyMatchingACLList(
      access,
      kSecACLAuthorizationDecrypt
    ) as? [SecACL], !aclList.isEmpty else {
      throw ProvisionFailure("the launcher-only Keychain decrypt ACL is unavailable")
    }
    for acl in aclList {
      guard
        SecACLSetContents(
          acl,
          trustedList,
          description,
          launcherPromptSelector
        ) == errSecSuccess
      else {
        throw ProvisionFailure("the launcher-only Keychain prompt policy could not be set")
      }
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
        try trustedApplicationData(trustedApplications[0]) == expectedData,
        selector == launcherPromptSelector
      else {
        return false
      }
    }
    return true
  }

  func inspect(
    service: String,
    account: String,
    launcherPath: String
  ) throws -> StoredCredentialMetadata {
    return StoredCredentialMetadata(
      launcherACLMatches: try aclMatches(
        service: service,
        account: account,
        launcherPath: launcherPath
      )
    )
  }

  func readOwnerInteractive(
    service: String,
    account: String,
    launcherPath: String
  ) throws -> StoredCredential {
    let itemMetadata = try inspect(
      service: service,
      account: account,
      launcherPath: launcherPath
    )
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
      launcherACLMatches: itemMetadata.launcherACLMatches
    )
  }

  func add(
    service: String,
    account: String,
    secret: Data,
    launcherPath: String
  ) throws -> CreatedCredentialHandle {
    var attributes = identityQuery(service: service, account: account)
    attributes[kSecAttrLabel] = "Freed automation actor \(account)"
    attributes[kSecValueData] = secret
    attributes[kSecAttrAccess] = try access(launcherPath, account: account)
    attributes[kSecReturnPersistentRef] = true
    var result: CFTypeRef?
    let status = SecItemAdd(attributes as CFDictionary, &result)
    if status == errSecDuplicateItem { throw StoreFailure.duplicateItem }
    guard status == errSecSuccess,
      let persistentReference = result as? Data,
      !persistentReference.isEmpty,
      persistentReference.count <= maximumCredentialBytes
    else {
      throw ProvisionFailure("the actor Keychain credential could not be created")
    }
    return .system(persistentReference)
  }

  func deleteCreated(_ handle: CreatedCredentialHandle) throws {
    guard case .system(let persistentReference) = handle else {
      throw ProvisionFailure("the created actor Keychain item identity is invalid")
    }
    let query = [kSecMatchItemList: [persistentReference] as CFArray]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess else {
      throw ProvisionFailure("the newly created actor Keychain credential could not be rolled back")
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

private func withKeychainInteractionDisabled<T>(
  controller: KeychainInteractionController,
  restorationFailureCleanup: ((T) throws -> Void)? = nil,
  operation: () throws -> T
) throws -> T {
  let previousInteractionState = try controller.currentState()
  try controller.setAllowed(false)
  guard try controller.currentState() == false else {
    throw ProvisionFailure(
      "the Keychain interaction policy remained enabled after the disable request"
    )
  }

  let operationResult: Result<T, Error>
  do {
    operationResult = .success(try operation())
  } catch {
    operationResult = .failure(error)
  }

  do {
    try controller.setAllowed(previousInteractionState)
    guard try controller.currentState() == previousInteractionState else {
      throw ProvisionFailure("the Keychain interaction policy restored an unexpected state")
    }
  } catch {
    if case .success(let result) = operationResult,
      let restorationFailureCleanup
    {
      do {
        try controller.setAllowed(false)
        guard try controller.currentState() == false else {
          throw ProvisionFailure(
            "the Keychain interaction policy remained enabled before lifecycle rollback"
          )
        }
        try restorationFailureCleanup(result)
      } catch {
        throw ProvisionFailure(
          "the Keychain interaction policy could not be restored and the completed lifecycle action could not be rolled back"
        )
      }
    }
    throw ProvisionFailure(
      "the Keychain interaction policy could not be restored after the lifecycle action"
    )
  }
  return try operationResult.get()
}

private func parseArguments(_ values: [String]) throws -> ParsedArguments {
  guard let first = values.first, let action = ProvisionAction(rawValue: first) else {
    throw ProvisionFailure("the provisioner requires provision, rotate, or revoke")
  }
  var options: [String: String] = [:]
  var allowed = Set(["--actor", "--state-root"])
  #if AUTOMATION_ACTOR_PROVISION_TESTING
    allowed.insert("--test-binding")
    allowed.insert("--test-runtime-root")
    allowed.insert("--test-keychain-state")
    allowed.insert("--test-interaction-mode")
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
    let testInteractionMode = options["--test-interaction-mode"] ?? "valid"
    guard [
      "valid", "initially-disabled", "get-failure", "disable-failure", "disable-noop",
      "restore-failure", "restore-failure-with-digest-drift",
    ].contains(testInteractionMode) else {
      throw ProvisionFailure("the provisioner test interaction mode is invalid")
    }
    return ParsedArguments(
      action: action,
      actor: actor,
      stateRoot: stateRoot,
      testBindingPath: testBindingPath,
      testRuntimeRoot: testRuntimeRoot,
      testKeychainState: testKeychainState,
      testInteractionMode: testInteractionMode
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
    value.st_mode & 0o7000 == 0,
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
    "freed-automation-actor-runtime-v2\n" +
    "node:\(binding.nodeSha256)\n" +
    "automation-control.mjs:\(binding.controlEntrySha256)\n" +
    "lib/automation-control.mjs:\(binding.controlLibrarySha256)\n" +
    "lib/lease-archive-move.py:\(binding.leaseArchiveHelperSha256)\n"
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
      "leaseArchiveHelperPath", "leaseArchiveHelperSha256",
    ],
    label: "actor launcher binding"
  )
  let attestationProtocolIsAccepted =
    binding.attestationProtocol == attestationProtocol ||
    (arguments.action == .revoke &&
      binding.attestationProtocol == legacyAttestationProtocol)
  guard binding.schemaVersion == bindingSchemaVersion,
    binding.actor == arguments.actor,
    binding.purpose == bindingPurpose,
    binding.handoff == bindingHandoff,
    attestationProtocolIsAccepted,
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
  try requireLowercaseHex(binding.leaseArchiveHelperSha256, length: 64, label: "lease archive helper digest")

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
    binding.controlLibraryPath == expectedRuntimeDirectory + "/lib/automation-control.mjs",
    binding.leaseArchiveHelperPath == expectedRuntimeDirectory + "/lib/lease-archive-move.py"
  else {
    throw ProvisionFailure("the pinned actor runtime does not use the canonical content-addressed layout")
  }
  let runtimePins = [
    (binding.nodePath, binding.nodeSha256, true, "Node runtime"),
    (binding.controlEntryPath, binding.controlEntrySha256, false, "automation control entry"),
    (binding.controlLibraryPath, binding.controlLibrarySha256, false, "automation control library"),
    (binding.leaseArchiveHelperPath, binding.leaseArchiveHelperSha256, false, "lease archive helper"),
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

private func removeCredentialIfMatching(
  _ expected: ActorCredentialRecord,
  binding: LauncherBinding
) throws {
  guard let current = try readCredentialIfPresent(binding) else { return }
  guard current == expected else {
    throw ProvisionFailure("the actor credential record changed before provisioning rollback")
  }
  try removeCredentialIfPresent(binding)
}

private func requireCredentialMatching(
  _ expected: ActorCredentialRecord,
  binding: LauncherBinding
) throws {
  guard let current = try readCredentialIfPresent(binding), current == expected else {
    throw ProvisionFailure("the actor credential record changed before provisioning rollback")
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
    _ = try store.inspect(
      service: binding.keychainService,
      account: binding.keychainAccount,
      launcherPath: binding.launcherPath
    )
    return true
  } catch StoreFailure.itemNotFound {
    return false
  }
}

private func provision(
  binding: LauncherBinding,
  store: SecretStore,
  generator: CredentialGenerator
) throws -> ProvisionRollback {
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
  let createdItem = try store.add(
    service: binding.keychainService,
    account: binding.keychainAccount,
    secret: secret,
    launcherPath: binding.launcherPath
  )
  let record = ActorCredentialRecord(
    schemaVersion: credentialSchemaVersion,
    actor: binding.actor,
    purpose: credentialPurpose,
    tokenSha256: sha256Hex(secret)
  )
  do {
    try writeCredentialAtomic(record, binding: binding)
  } catch {
    do {
      try store.deleteCreated(createdItem)
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
  return ProvisionRollback(createdItem: createdItem, record: record)
}

private func rollbackProvision(
  _ rollback: ProvisionRollback,
  binding: LauncherBinding,
  store: SecretStore
) throws {
  do {
    try requireCredentialMatching(rollback.record, binding: binding)
    try store.deleteCreated(rollback.createdItem)
    try removeCredentialIfMatching(rollback.record, binding: binding)
  } catch {
    throw ProvisionFailure(
      "the completed actor credential provision could not be fully rolled back"
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
  var previous = try store.readOwnerInteractive(
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
    let interactionController = FakeKeychainInteractionController(
      mode: arguments.testInteractionMode,
      stateRoot: arguments.stateRoot,
      actor: arguments.actor
    )
    let store: SecretStore = try FakeSecretStore(
      state: arguments.testKeychainState,
      stateRoot: arguments.stateRoot,
      interactionController: interactionController
    )
    let generator: CredentialGenerator = FakeCredentialGenerator()
  #else
    let interactionController = SystemKeychainInteractionController()
    let store: SecretStore = KeychainSecretStore()
    let generator: CredentialGenerator = SecureCredentialGenerator()
  #endif
  switch arguments.action {
  case .provision:
    _ = try withKeychainInteractionDisabled(
      controller: interactionController,
      restorationFailureCleanup: { rollback in
        try rollbackProvision(rollback, binding: binding, store: store)
      }
    ) {
      try provision(binding: binding, store: store, generator: generator)
    }
    try writeResult(arguments.action, binding: binding, ready: true)
  case .rotate:
    try rotate(binding: binding, store: store, generator: generator)
    try writeResult(arguments.action, binding: binding, ready: true)
  case .revoke:
    try withKeychainInteractionDisabled(controller: interactionController) {
      try revoke(binding: binding, store: store)
    }
    try writeResult(arguments.action, binding: binding, ready: false)
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
} catch {
  fputs("automation-actor-provision: an unexpected provisioning error occurred\n", stderr)
  exit(1)
}
