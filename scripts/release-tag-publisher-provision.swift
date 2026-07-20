import CryptoKit
import Darwin
import Foundation
import Security

private let keychainService = "freed-release-tag-publisher"
private let keychainAccount = "github-app-private-key"
private let maximumKeyBytes = 32 * 1_024

private struct ProvisionFailure: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

private enum StoreFailure: Error {
  case missing
  case duplicate
}

private enum ItemHandle {
  case system(SecKeychainItem)
  #if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
    case testing(String)
  #endif
}

private protocol SecretStore: AnyObject {
  func inspect(host: String, provisioner: String) throws -> ItemHandle?
  func read(_ handle: ItemHandle, host: String, provisioner: String) throws -> Data
  func add(_ secret: Data, host: String, provisioner: String) throws -> ItemHandle
  func update(
    _ handle: ItemHandle,
    secret: Data,
    host: String,
    provisioner: String
  ) throws
  func deleteExact(_ handle: ItemHandle) throws
}

private struct ParsedArguments {
  let action: String
  let host: String
  let expectedSha256: String?
  #if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
    let testStore: String?
    let testFailure: String?
  #endif
}

private struct ProvisionResult: Encodable {
  let schemaVersion = 1
  let purpose = "freed-release-tag-publisher-keychain-result"
  let action: String
  let service = keychainService
  let account = keychainAccount
  let host: String
  let state: String?
  let changed: Bool?
  let matched: Bool?
}

private func fail(_ message: String) throws -> Never {
  throw ProvisionFailure(message)
}

private func sha256Hex(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func canonicalExistingPath(_ path: String, label: String) throws -> String {
  guard path.hasPrefix("/"), !path.contains("\n"), !path.contains("\r") else {
    try fail("The \(label) must be an absolute path without control characters.")
  }
  guard let resolved = realpath(path, nil) else {
    try fail("The \(label) does not resolve to an existing path.")
  }
  defer { free(resolved) }
  return String(cString: resolved)
}

private func currentExecutablePath() throws -> String {
  var size: UInt32 = 0
  _ = _NSGetExecutablePath(nil, &size)
  var buffer = [CChar](repeating: 0, count: Int(size))
  guard _NSGetExecutablePath(&buffer, &size) == 0 else {
    try fail("The publisher provisioner path is unavailable.")
  }
  return try canonicalExistingPath(
    String(cString: buffer),
    label: "publisher provisioner"
  )
}

private func requireTrustedExecutable(
  _ path: String,
  testingOwnerAllowed: Bool = false
) throws {
  let canonical = try canonicalExistingPath(path, label: "publisher executable")
  guard canonical == path else {
    try fail("Publisher executables must use canonical paths.")
  }
  var link = stat()
  var metadata = stat()
  let linkStatus = path.withCString {
    fstatat(AT_FDCWD, $0, &link, AT_SYMLINK_NOFOLLOW)
  }
  let metadataStatus = path.withCString {
    fstatat(AT_FDCWD, $0, &metadata, 0)
  }
  let trustedOwner = metadata.st_uid == 0 ||
    (testingOwnerAllowed && metadata.st_uid == getuid())
  guard linkStatus == 0, metadataStatus == 0,
    (link.st_mode & S_IFMT) != S_IFLNK,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    trustedOwner,
    metadata.st_mode & 0o022 == 0,
    metadata.st_mode & 0o111 != 0
  else {
    try fail(
      "Publisher executables must be trusted, executable, and immutable to other users."
    )
  }
}

private func validatePKCS1PEM(_ data: Data) throws {
  guard !data.isEmpty, data.count <= maximumKeyBytes,
    let text = String(data: data, encoding: .utf8)
  else { try fail("The release App key is empty, oversized, or not UTF-8.") }
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  let begin = "-----BEGIN RSA PRIVATE KEY-----"
  let end = "-----END RSA PRIVATE KEY-----"
  guard trimmed.hasPrefix(begin), trimmed.hasSuffix(end),
    !trimmed.contains("BEGIN PRIVATE KEY")
  else {
    try fail("The release App key must use PKCS1 RSA PRIVATE KEY PEM.")
  }
  let start = trimmed.index(trimmed.startIndex, offsetBy: begin.count)
  let finish = trimmed.index(trimmed.endIndex, offsetBy: -end.count)
  let body = trimmed[start..<finish].filter { !$0.isWhitespace }
  guard !body.isEmpty, let der = Data(base64Encoded: String(body)) else {
    try fail("The release App PKCS1 key body is invalid base64.")
  }
  let attributes: [CFString: Any] = [
    kSecAttrKeyType: kSecAttrKeyTypeRSA,
    kSecAttrKeyClass: kSecAttrKeyClassPrivate,
  ]
  var error: Unmanaged<CFError>?
  guard let key = SecKeyCreateWithData(der as CFData, attributes as CFDictionary, &error),
    let details = SecKeyCopyAttributes(key) as? [CFString: Any],
    let bits = details[kSecAttrKeySizeInBits] as? Int,
    bits >= 2_048
  else { try fail("The release App key must be a valid RSA key with at least 2,048 bits.") }
}

private func readSecretFromStandardInput() throws -> Data {
  var data = Data()
  while data.count <= maximumKeyBytes {
    let remaining = maximumKeyBytes + 1 - data.count
    let chunk = FileHandle.standardInput.readData(ofLength: min(4_096, remaining))
    if chunk.isEmpty { break }
    data.append(chunk)
  }
  try validatePKCS1PEM(data)
  return data
}

private final class KeychainStore: SecretStore {
  private func query() -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: keychainService,
      kSecAttrAccount: keychainAccount,
    ]
  }

  private func trustedApplication(_ path: String) throws -> SecTrustedApplication {
    var application: SecTrustedApplication?
    let status = path.withCString { SecTrustedApplicationCreateFromPath($0, &application) }
    guard status == errSecSuccess, let application else {
      try fail("A publisher Keychain application identity could not be created.")
    }
    return application
  }

  private func applicationData(_ application: SecTrustedApplication) throws -> Data {
    var data: CFData?
    guard SecTrustedApplicationCopyData(application, &data) == errSecSuccess, let data else {
      try fail("A publisher Keychain application identity is unreadable.")
    }
    return data as Data
  }

  private func access(host: String, provisioner: String) throws -> SecAccess {
    let applications = [
      try trustedApplication(host),
      try trustedApplication(provisioner),
    ] as CFArray
    var access: SecAccess?
    let status = SecAccessCreate(
      "Freed release tag publisher private key" as CFString,
      applications,
      &access
    )
    guard status == errSecSuccess, let access else {
      try fail("The publisher-only Keychain ACL could not be created.")
    }
    return access
  }

  private func itemReference() throws -> SecKeychainItem {
    var itemQuery = query()
    itemQuery[kSecReturnRef] = true
    itemQuery[kSecMatchLimit] = kSecMatchLimitOne
    itemQuery[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
    var result: CFTypeRef?
    let status = SecItemCopyMatching(itemQuery as CFDictionary, &result)
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess, let item = result as! SecKeychainItem? else {
      try fail("The publisher Keychain item reference is unavailable.")
    }
    return item
  }

  private func systemItem(_ handle: ItemHandle) throws -> SecKeychainItem {
    guard case .system(let item) = handle else {
      try fail("The publisher Keychain item reference is invalid.")
    }
    return item
  }

  private func aclMatches(
    _ item: SecKeychainItem,
    host: String,
    provisioner: String
  ) throws -> Bool {
    var itemAccess: SecAccess?
    guard SecKeychainItemCopyAccess(item, &itemAccess) == errSecSuccess,
      let itemAccess
    else { try fail("The publisher Keychain ACL is unavailable.") }
    let expected = Set(try [host, provisioner].map {
      try applicationData(trustedApplication($0)).base64EncodedString()
    })
    guard let aclList = SecAccessCopyMatchingACLList(
      itemAccess,
      kSecACLAuthorizationDecrypt
    ) as? [SecACL], !aclList.isEmpty else { return false }
    for acl in aclList {
      var applications: CFArray?
      var description: CFString?
      var selector = SecKeychainPromptSelector()
      guard SecACLCopyContents(acl, &applications, &description, &selector) == errSecSuccess,
        let trusted = applications as? [SecTrustedApplication]
      else { return false }
      let actual = Set(try trusted.map {
        try applicationData($0).base64EncodedString()
      })
      if actual != expected { return false }
    }
    return true
  }

  func inspect(host: String, provisioner: String) throws -> ItemHandle? {
    do {
      let item = try itemReference()
      guard try aclMatches(item, host: host, provisioner: provisioner) else {
        try fail(
          "The release App key is not restricted to the publisher host and provisioner."
        )
      }
      return .system(item)
    } catch StoreFailure.missing {
      return nil
    }
  }

  func read(
    _ handle: ItemHandle,
    host: String,
    provisioner: String
  ) throws -> Data {
    let item = try systemItem(handle)
    guard try aclMatches(item, host: host, provisioner: provisioner) else {
      try fail(
        "The release App key is not restricted to the publisher host and provisioner."
      )
    }
    let dataQuery: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecMatchItemList: [item] as CFArray,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
      kSecUseAuthenticationUI: kSecUseAuthenticationUIFail,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(dataQuery as CFDictionary, &result)
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess, let data = result as? Data else {
      try fail("The release App key could not be read from Keychain.")
    }
    return data
  }

  func add(_ secret: Data, host: String, provisioner: String) throws -> ItemHandle {
    var attributes = query()
    attributes[kSecAttrLabel] = "Freed release tag publisher private key"
    attributes[kSecValueData] = secret
    attributes[kSecAttrAccess] = try access(host: host, provisioner: provisioner)
    attributes[kSecReturnRef] = true
    var result: CFTypeRef?
    let status = SecItemAdd(attributes as CFDictionary, &result)
    if status == errSecDuplicateItem { throw StoreFailure.duplicate }
    guard status == errSecSuccess, let item = result as! SecKeychainItem? else {
      try fail("The release App key could not be added to Keychain.")
    }
    return .system(item)
  }

  func update(
    _ handle: ItemHandle,
    secret: Data,
    host: String,
    provisioner: String
  ) throws {
    let item = try systemItem(handle)
    let status = SecItemUpdate(
      [
        kSecClass: kSecClassGenericPassword,
        kSecMatchItemList: [item] as CFArray,
      ] as CFDictionary,
      [kSecValueData: secret] as CFDictionary
    )
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess else {
      try fail("The release App key could not be rotated in Keychain.")
    }
    guard SecKeychainItemSetAccess(
      item,
      try access(host: host, provisioner: provisioner)
    ) == errSecSuccess else {
      try fail("The rotated release App key ACL could not be constrained.")
    }
  }

  func deleteExact(_ handle: ItemHandle) throws {
    let status = SecKeychainItemDelete(try systemItem(handle))
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess else {
      try fail("The release App key could not be revoked from Keychain.")
    }
  }
}

#if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
  private struct FakeStoreState: Codable {
    var itemId: String?
    var secretBase64: String?
    var host: String?
    var provisioner: String?
    var exactDeleteCount: Int
  }

  private final class FakeKeychainStore: SecretStore {
    private let statePath: String
    private let failure: String?
    private var state: FakeStoreState
    private var createdItemId: String?

    init(statePath: String, failure: String?) throws {
      self.statePath = try canonicalExistingPath(statePath, label: "test Keychain state")
      self.failure = failure
      let metadata = try Self.fileMetadata(self.statePath)
      guard (metadata.st_mode & S_IFMT) == S_IFREG,
        metadata.st_uid == getuid(),
        metadata.st_mode & 0o077 == 0
      else { try fail("The test Keychain state must be a private current-user file.") }
      state = try JSONDecoder().decode(
        FakeStoreState.self,
        from: Data(contentsOf: URL(fileURLWithPath: self.statePath))
      )
    }

    private static func fileMetadata(_ path: String) throws -> stat {
      var metadata = stat()
      guard path.withCString({ fstatat(AT_FDCWD, $0, &metadata, AT_SYMLINK_NOFOLLOW) }) == 0 else {
        try fail("The test Keychain state metadata is unavailable.")
      }
      return metadata
    }

    private func persist() throws {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      try encoder.encode(state).write(
        to: URL(fileURLWithPath: statePath),
        options: [.atomic]
      )
      guard chmod(statePath, 0o600) == 0 else {
        try fail("The test Keychain state could not be secured.")
      }
    }

    private func testingId(_ handle: ItemHandle) throws -> String {
      guard case .testing(let itemId) = handle else {
        try fail("The test Keychain item reference is invalid.")
      }
      return itemId
    }

    private func requireExact(
      _ handle: ItemHandle,
      host: String,
      provisioner: String
    ) throws -> String {
      let itemId = try testingId(handle)
      guard state.itemId == itemId else { throw StoreFailure.missing }
      guard state.host == host, state.provisioner == provisioner else {
        try fail(
          "The release App key is not restricted to the publisher host and provisioner."
        )
      }
      return itemId
    }

    func inspect(host: String, provisioner: String) throws -> ItemHandle? {
      guard let itemId = state.itemId else { return nil }
      guard state.host == host, state.provisioner == provisioner else {
        try fail(
          "The release App key is not restricted to the publisher host and provisioner."
        )
      }
      return .testing(itemId)
    }

    func read(
      _ handle: ItemHandle,
      host: String,
      provisioner: String
    ) throws -> Data {
      let itemId = try requireExact(handle, host: host, provisioner: provisioner)
      if (failure == "read-created" || failure == "read-created-delete-created"),
        createdItemId == itemId
      {
        try fail("Injected test failure while validating the created item.")
      }
      guard let encoded = state.secretBase64,
        let data = Data(base64Encoded: encoded)
      else { try fail("The test Keychain secret is unavailable.") }
      return data
    }

    func add(_ secret: Data, host: String, provisioner: String) throws -> ItemHandle {
      guard state.itemId == nil else { throw StoreFailure.duplicate }
      let itemId = UUID().uuidString.lowercased()
      state.itemId = itemId
      state.secretBase64 = secret.base64EncodedString()
      state.host = host
      state.provisioner = provisioner
      createdItemId = itemId
      try persist()
      return .testing(itemId)
    }

    func update(
      _ handle: ItemHandle,
      secret: Data,
      host: String,
      provisioner: String
    ) throws {
      _ = try requireExact(handle, host: host, provisioner: provisioner)
      state.secretBase64 = secret.base64EncodedString()
      state.host = host
      state.provisioner = provisioner
      try persist()
    }

    func deleteExact(_ handle: ItemHandle) throws {
      let itemId = try testingId(handle)
      guard state.itemId == itemId else { throw StoreFailure.missing }
      if (failure == "delete-created" || failure == "read-created-delete-created"),
        createdItemId == itemId
      {
        try fail("Injected test failure while deleting the created item.")
      }
      state.itemId = nil
      state.secretBase64 = nil
      state.host = nil
      state.provisioner = nil
      state.exactDeleteCount += 1
      try persist()
    }
  }
#endif

private func parse(_ arguments: [String]) throws -> ParsedArguments {
  guard let action = arguments.first,
    [
      "inspect", "provision", "recover", "matches", "rotate", "verify",
      "discard-recovery", "revoke",
    ].contains(action)
  else {
    try fail(
      "Usage: release-tag-publisher-provision <inspect|provision|recover|matches|rotate|verify|discard-recovery|revoke> --host <absolute-path> [--expected-sha256 <sha256>]"
    )
  }
  var values: [String: String] = [:]
  var index = 1
  var allowed: Set<String> = ["--host", "--expected-sha256"]
  #if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
    allowed.formUnion(["--test-store", "--test-failure"])
  #endif
  while index < arguments.count {
    let flag = arguments[index]
    guard allowed.contains(flag), index + 1 < arguments.count,
      values[flag] == nil
    else { try fail("The publisher provisioner received invalid or duplicate options.") }
    values[flag] = arguments[index + 1]
    index += 2
  }
  guard let host = values["--host"] else {
    try fail("The publisher provisioner requires --host.")
  }
  let expectedSha256 = values["--expected-sha256"]
  let expectsDigest = [
    "recover", "matches", "rotate", "discard-recovery",
  ].contains(action)
  guard expectsDigest == (expectedSha256 != nil) else {
    try fail(
      "recover, matches, rotate, and discard-recovery require one --expected-sha256; other actions reject it."
    )
  }
  if let expectedSha256 {
    guard expectedSha256.count == 64,
      expectedSha256.allSatisfy({ $0.isNumber || ($0 >= "a" && $0 <= "f") })
    else { try fail("The expected release App key digest must be 64 lowercase hex characters.") }
  }
  #if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
    let testStore = values["--test-store"]
    let testFailure = values["--test-failure"]
    if testFailure != nil && testStore == nil {
      try fail("Test failure injection requires --test-store.")
    }
    if let testFailure,
      ![
        "read-created", "delete-created", "read-created-delete-created",
      ].contains(testFailure)
    {
      try fail("The requested test failure is unsupported.")
    }
    return ParsedArguments(
      action: action,
      host: host,
      expectedSha256: expectedSha256,
      testStore: testStore,
      testFailure: testFailure
    )
  #else
    return ParsedArguments(
      action: action,
      host: host,
      expectedSha256: expectedSha256
    )
  #endif
}

private func disableCoreDumps() throws {
  var limit = rlimit(rlim_cur: 0, rlim_max: 0)
  guard setrlimit(RLIMIT_CORE, &limit) == 0 else {
    try fail("The publisher provisioner could not disable core dumps.")
  }
}

private func requireStoredHandle(
  store: SecretStore,
  host: String,
  provisioner: String
) throws -> ItemHandle {
  guard let handle = try store.inspect(host: host, provisioner: provisioner) else {
    throw StoreFailure.missing
  }
  return handle
}

private func addAndValidate(
  _ secret: Data,
  store: SecretStore,
  host: String,
  provisioner: String
) throws {
  var created: ItemHandle?
  do {
    let handle = try store.add(secret, host: host, provisioner: provisioner)
    created = handle
    var verified = try store.read(handle, host: host, provisioner: provisioner)
    defer { verified.resetBytes(in: 0..<verified.count) }
    try validatePKCS1PEM(verified)
    guard sha256Hex(verified) == sha256Hex(secret) else {
      try fail("The created release App key does not match the supplied replacement.")
    }
  } catch {
    if let created {
      do {
        try store.deleteExact(created)
      } catch {
        try fail(
          "Release App key creation failed and the exact newly created item could not be rolled back."
        )
      }
    }
    throw error
  }
}

private func writeResult(_ result: ProvisionResult) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  FileHandle.standardOutput.write(try encoder.encode(result) + Data([0x0a]))
}

private func main() -> Int32 {
  do {
    _ = umask(0o077)
    try disableCoreDumps()
    let parsed = try parse(Array(CommandLine.arguments.dropFirst()))
    let host = try canonicalExistingPath(parsed.host, label: "publisher host")
    let provisioner = try currentExecutablePath()
    #if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
      let testing = parsed.testStore != nil
    #else
      let testing = false
    #endif
    try requireTrustedExecutable(host, testingOwnerAllowed: testing)
    try requireTrustedExecutable(provisioner, testingOwnerAllowed: testing)
    let store: SecretStore
    #if RELEASE_TAG_PUBLISHER_PROVISIONER_TESTING
      if let testStore = parsed.testStore {
        store = try FakeKeychainStore(
          statePath: testStore,
          failure: parsed.testFailure
        )
      } else {
        store = KeychainStore()
      }
    #else
      store = KeychainStore()
    #endif

    var state: String?
    var changed: Bool?
    var matched: Bool?
    switch parsed.action {
    case "inspect":
      state = try store.inspect(host: host, provisioner: provisioner) == nil
        ? "missing" : "present"
    case "provision", "recover":
      if parsed.action == "recover",
        try store.inspect(host: host, provisioner: provisioner) != nil
      {
        throw StoreFailure.duplicate
      }
      var secret = try readSecretFromStandardInput()
      defer { secret.resetBytes(in: 0..<secret.count) }
      if parsed.action == "recover",
        sha256Hex(secret) != parsed.expectedSha256
      {
        try fail("The recovery key does not match the admitted file digest.")
      }
      try addAndValidate(
        secret,
        store: store,
        host: host,
        provisioner: provisioner
      )
      changed = true
    case "matches":
      let handle = try requireStoredHandle(
        store: store,
        host: host,
        provisioner: provisioner
      )
      var secret = try store.read(handle, host: host, provisioner: provisioner)
      defer { secret.resetBytes(in: 0..<secret.count) }
      try validatePKCS1PEM(secret)
      guard sha256Hex(secret) == parsed.expectedSha256 else {
        try fail("The installed release App key does not match the expected recovery digest.")
      }
      matched = true
    case "rotate":
      let handle = try requireStoredHandle(
        store: store,
        host: host,
        provisioner: provisioner
      )
      var previous = try store.read(handle, host: host, provisioner: provisioner)
      defer { previous.resetBytes(in: 0..<previous.count) }
      try validatePKCS1PEM(previous)
      var replacement = try readSecretFromStandardInput()
      defer { replacement.resetBytes(in: 0..<replacement.count) }
      guard sha256Hex(replacement) == parsed.expectedSha256 else {
        try fail("The replacement key does not match the admitted file digest.")
      }
      do {
        try store.update(
          handle,
          secret: replacement,
          host: host,
          provisioner: provisioner
        )
        var verified = try store.read(handle, host: host, provisioner: provisioner)
        defer { verified.resetBytes(in: 0..<verified.count) }
        try validatePKCS1PEM(verified)
        guard sha256Hex(verified) == sha256Hex(replacement) else {
          try fail("The rotated release App key does not match the replacement.")
        }
      } catch {
        do {
          try store.update(
            handle,
            secret: previous,
            host: host,
            provisioner: provisioner
          )
        } catch {
          try fail("Release App key rotation failed and the prior value could not be restored.")
        }
        throw error
      }
      changed = true
    case "verify":
      let handle = try requireStoredHandle(
        store: store,
        host: host,
        provisioner: provisioner
      )
      var secret = try store.read(handle, host: host, provisioner: provisioner)
      defer { secret.resetBytes(in: 0..<secret.count) }
      try validatePKCS1PEM(secret)
    case "discard-recovery":
      guard let handle = try store.inspect(host: host, provisioner: provisioner) else {
        changed = false
        break
      }
      var secret = try store.read(handle, host: host, provisioner: provisioner)
      defer { secret.resetBytes(in: 0..<secret.count) }
      try validatePKCS1PEM(secret)
      guard sha256Hex(secret) == parsed.expectedSha256 else {
        try fail("The staged release App key does not match the authorized discard digest.")
      }
      try store.deleteExact(handle)
      changed = true
    case "revoke":
      let handle = try requireStoredHandle(
        store: store,
        host: host,
        provisioner: provisioner
      )
      try store.deleteExact(handle)
      changed = true
    default:
      try fail("Unsupported publisher provisioner action.")
    }
    try writeResult(
      ProvisionResult(
        action: parsed.action,
        host: host,
        state: state,
        changed: changed,
        matched: matched
      )
    )
    return 0
  } catch StoreFailure.missing {
    fputs("release-tag-publisher-provision: the Keychain key is missing\n", stderr)
    return 1
  } catch StoreFailure.duplicate {
    fputs("release-tag-publisher-provision: the Keychain key already exists\n", stderr)
    return 1
  } catch let error as ProvisionFailure {
    fputs("release-tag-publisher-provision: \(error.description)\n", stderr)
    return 1
  } catch {
    fputs("release-tag-publisher-provision: an unexpected validation error occurred\n", stderr)
    return 1
  }
}

exit(main())
