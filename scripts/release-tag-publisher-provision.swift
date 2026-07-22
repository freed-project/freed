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

private func fail(_ message: String) throws -> Never {
  throw ProvisionFailure(message)
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
  return try canonicalExistingPath(String(cString: buffer), label: "publisher provisioner")
}

private func requireRootOwnedExecutable(_ path: String) throws {
  let canonical = try canonicalExistingPath(path, label: "publisher executable")
  guard canonical == path else { try fail("Publisher executables must use canonical paths.") }
  var link = stat()
  var metadata = stat()
  let linkStatus = path.withCString {
    fstatat(AT_FDCWD, $0, &link, AT_SYMLINK_NOFOLLOW)
  }
  let metadataStatus = path.withCString {
    fstatat(AT_FDCWD, $0, &metadata, 0)
  }
  guard linkStatus == 0, metadataStatus == 0,
    (link.st_mode & S_IFMT) != S_IFLNK,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    metadata.st_uid == 0,
    metadata.st_mode & 0o022 == 0,
    metadata.st_mode & 0o111 != 0
  else {
    try fail("Publisher executables must be root owned, executable, and immutable to other users.")
  }
}

private func validatePKCS1PEM(_ data: Data) throws {
  guard !data.isEmpty, data.count <= maximumKeyBytes,
    let text = String(data: data, encoding: .utf8)
  else { try fail("The release App key is empty, oversized, or not UTF-8.") }
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  let begin = "-----BEGIN RSA PRIVATE KEY-----"
  let end = "-----END RSA PRIVATE KEY-----"
  guard trimmed.hasPrefix(begin), trimmed.hasSuffix(end) else {
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
    bits >= 2048
  else { try fail("The release App key must be a valid RSA key with at least 2,048 bits.") }
}

private func readSecretFromStandardInput() throws -> Data {
  let data = FileHandle.standardInput.readData(ofLength: maximumKeyBytes + 1)
  try validatePKCS1PEM(data)
  return data
}

private final class KeychainStore {
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

  private func aclMatches(host: String, provisioner: String) throws -> Bool {
    let item = try itemReference()
    var itemAccess: SecAccess?
    guard SecKeychainItemCopyAccess(item, &itemAccess) == errSecSuccess, let itemAccess else {
      try fail("The publisher Keychain ACL is unavailable.")
    }
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

  func read(host: String, provisioner: String) throws -> Data {
    var dataQuery = query()
    dataQuery[kSecReturnData] = true
    dataQuery[kSecMatchLimit] = kSecMatchLimitOne
    dataQuery[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
    var result: CFTypeRef?
    let status = SecItemCopyMatching(dataQuery as CFDictionary, &result)
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess, let data = result as? Data else {
      try fail("The release App key could not be read from Keychain.")
    }
    guard try aclMatches(host: host, provisioner: provisioner) else {
      try fail("The release App key is not restricted to the publisher host and provisioner.")
    }
    return data
  }

  func add(_ secret: Data, host: String, provisioner: String) throws {
    var attributes = query()
    attributes[kSecAttrLabel] = "Freed release tag publisher private key"
    attributes[kSecValueData] = secret
    attributes[kSecAttrAccess] = try access(host: host, provisioner: provisioner)
    let status = SecItemAdd(attributes as CFDictionary, nil)
    if status == errSecDuplicateItem { throw StoreFailure.duplicate }
    guard status == errSecSuccess else {
      try fail("The release App key could not be added to Keychain.")
    }
  }

  func update(_ secret: Data, host: String, provisioner: String) throws {
    let status = SecItemUpdate(
      query() as CFDictionary,
      [kSecValueData: secret] as CFDictionary
    )
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess else {
      try fail("The release App key could not be rotated in Keychain.")
    }
    let item = try itemReference()
    guard SecKeychainItemSetAccess(
      item,
      try access(host: host, provisioner: provisioner)
    ) == errSecSuccess else {
      try fail("The rotated release App key ACL could not be constrained.")
    }
  }

  func delete() throws {
    let status = SecItemDelete(query() as CFDictionary)
    if status == errSecItemNotFound { throw StoreFailure.missing }
    guard status == errSecSuccess else {
      try fail("The release App key could not be revoked from Keychain.")
    }
  }
}

private func parse(_ arguments: [String]) throws -> (action: String, host: String) {
  guard arguments.count == 3,
    ["provision", "rotate", "verify", "revoke"].contains(arguments[0]),
    arguments[1] == "--host"
  else {
    try fail("Usage: release-tag-publisher-provision <provision|rotate|verify|revoke> --host <absolute-path>")
  }
  return (arguments[0], arguments[2])
}

private func disableCoreDumps() throws {
  var limit = rlimit(rlim_cur: 0, rlim_max: 0)
  guard setrlimit(RLIMIT_CORE, &limit) == 0 else {
    try fail("The publisher provisioner could not disable core dumps.")
  }
}

private func main() -> Int32 {
  do {
    _ = umask(0o077)
    try disableCoreDumps()
    let parsed = try parse(Array(CommandLine.arguments.dropFirst()))
    let host = try canonicalExistingPath(parsed.host, label: "publisher host")
    let provisioner = try currentExecutablePath()
    try requireRootOwnedExecutable(host)
    try requireRootOwnedExecutable(provisioner)
    let store = KeychainStore()
    switch parsed.action {
    case "provision":
      var secret = try readSecretFromStandardInput()
      defer { secret.resetBytes(in: 0..<secret.count) }
      do {
        try store.add(secret, host: host, provisioner: provisioner)
        var verified = try store.read(host: host, provisioner: provisioner)
        defer { verified.resetBytes(in: 0..<verified.count) }
        try validatePKCS1PEM(verified)
      } catch {
        try? store.delete()
        throw error
      }
    case "rotate":
      var previous = try store.read(host: host, provisioner: provisioner)
      defer { previous.resetBytes(in: 0..<previous.count) }
      var replacement = try readSecretFromStandardInput()
      defer { replacement.resetBytes(in: 0..<replacement.count) }
      do {
        try store.update(replacement, host: host, provisioner: provisioner)
        var verified = try store.read(host: host, provisioner: provisioner)
        defer { verified.resetBytes(in: 0..<verified.count) }
        try validatePKCS1PEM(verified)
      } catch {
        try? store.update(previous, host: host, provisioner: provisioner)
        throw error
      }
    case "verify":
      var secret = try store.read(host: host, provisioner: provisioner)
      defer { secret.resetBytes(in: 0..<secret.count) }
      try validatePKCS1PEM(secret)
    case "revoke":
      try store.delete()
    default:
      try fail("Unsupported publisher provisioner action.")
    }
    let output: [String: Any] = [
      "schemaVersion": 1,
      "purpose": "freed-release-tag-publisher-keychain-result",
      "action": parsed.action,
      "service": keychainService,
      "account": keychainAccount,
      "host": host,
    ]
    let data = try JSONSerialization.data(
      withJSONObject: output,
      options: [.sortedKeys, .withoutEscapingSlashes]
    )
    FileHandle.standardOutput.write(data + Data([0x0a]))
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
