import CryptoKit
import Darwin
import Foundation
import Security

private let productionConfigPath =
  "/Library/Application Support/Freed/release-tag-publisher.json"
private let productionProvisionerPath =
  "/Library/Application Support/Freed/release-tag-publisher-provision"
private let keychainService = "freed-release-tag-publisher"
private let keychainAccount = "github-app-private-key"
private let productionAPIBase = "https://api.github.com"
private let maximumConfigBytes = 32 * 1_024
private let maximumKeyBytes = 32 * 1_024
private let requestTimeout: TimeInterval = 30
private let requiredRuntimeSignatureFlag: UInt32 = 0x0001_0000

private struct HostFailure: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

private struct PublisherBinding: Decodable {
  let schemaVersion: Int
  let purpose: String
  let status: String
  let repo: String
  let appId: Int
  let appSlug: String
  let publisherPath: String
  let publisherSha256: String
  let publisherCdHash: String
  let provisionerPath: String
  let provisionerSha256: String
  let provisionerCdHash: String
  let nativePairSha256: String
}

private struct NativePairIdentity {
  let publisherSha256: String
  let publisherCdHash: String
  let provisionerSha256: String
  let provisionerCdHash: String
  let nativePairSha256: String
}

private struct ParsedCommand {
  let name: String
  let values: [String: String]
  let configPath: String
  let testKeyFile: String?
  let apiBase: String
}

private struct InstallationReadiness: Codable {
  let schemaVersion: Int
  let purpose: String
  let repo: String
  let appId: Int
  let appSlug: String
  let appName: String
  let appExternalUrl: String
  let appOwnerLogin: String
  let appOwnerType: String
  let appPermissions: [String: String]
  let appEvents: [String]
  let installationId: Int
  let accountLogin: String
  let accountType: String
  let repositorySelection: String
  let permissions: [String: String]
  let repositories: [String]
}

private struct InstallationContext {
  let readiness: InstallationReadiness
  var token: String
}

private struct HTTPResponse {
  let status: Int
  let data: Data
}

private func fail(_ message: String) throws -> Never {
  throw HostFailure(message)
}

private func usage() -> String {
  """
  Usage:
    release-tag-publisher attest --repo <owner/repo> --app-id <id> --app-slug <slug>
    release-tag-publisher verify-installation --repo <owner/repo> --app-id <id> --app-slug <slug>
    release-tag-publisher publish --repo <owner/repo> --worktree <path> --tag <tag> --channel <dev|production> --commit <sha> --branch <dev|main> --release-file <path> --release-file-sha256 <sha256>
  """
}

private func parseCommand(_ arguments: [String]) throws -> ParsedCommand {
  guard let name = arguments.first,
    ["attest", "verify-installation", "publish"].contains(name)
  else {
    try fail(usage())
  }
  var values: [String: String] = [:]
  var index = 1
  while index < arguments.count {
    let flag = arguments[index]
    guard flag.hasPrefix("--"), index + 1 < arguments.count else {
      try fail("Every publisher option must be a flag followed by one value.")
    }
    guard values[flag] == nil else {
      try fail("Publisher option \(flag) may only be provided once.")
    }
    let value = arguments[index + 1]
    guard !value.hasPrefix("--"), !value.isEmpty else {
      try fail("Publisher option \(flag) requires a value.")
    }
    values[flag] = value
    index += 2
  }

  var testingFlags: Set<String> = []
  #if RELEASE_TAG_PUBLISHER_HOST_TESTING
    testingFlags = ["--config", "--test-key-file", "--api-base"]
  #endif
  let identityFlags: Set<String> = ["--repo", "--app-id", "--app-slug"]
  let publishFlags: Set<String> = [
    "--repo", "--worktree", "--tag", "--channel", "--commit", "--branch",
    "--release-file", "--release-file-sha256",
  ]
  let expected = (name == "publish" ? publishFlags : identityFlags).union(testingFlags)
  let received = Set(values.keys)
  guard received.subtracting(testingFlags) == expected.subtracting(testingFlags),
    received.isSubset(of: expected)
  else {
    try fail("Publisher command \(name) received an incomplete or unsupported option set.")
  }

  #if RELEASE_TAG_PUBLISHER_HOST_TESTING
    let configPath = values["--config"] ?? productionConfigPath
    let keyFile = values["--test-key-file"]
    let apiBase = values["--api-base"] ?? productionAPIBase
    if apiBase != productionAPIBase {
      guard let url = URL(string: apiBase),
        url.scheme == "http",
        ["127.0.0.1", "localhost"].contains(url.host ?? "")
      else {
        try fail("The testing API base must be an HTTP loopback URL.")
      }
    }
  #else
    let configPath = productionConfigPath
    let keyFile: String? = nil
    let apiBase = productionAPIBase
  #endif
  return ParsedCommand(
    name: name,
    values: values,
    configPath: configPath,
    testKeyFile: keyFile,
    apiBase: apiBase
  )
}

private func currentExecutablePath() throws -> String {
  var size: UInt32 = 0
  _ = _NSGetExecutablePath(nil, &size)
  var buffer = [CChar](repeating: 0, count: Int(size))
  guard _NSGetExecutablePath(&buffer, &size) == 0 else {
    try fail("The publisher executable path is unavailable.")
  }
  return try canonicalExistingPath(String(cString: buffer), label: "publisher executable")
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

private func fileMetadata(_ path: String, followSymlink: Bool = false) throws -> stat {
  var metadata = stat()
  let status = path.withCString { pointer in
    fstatat(AT_FDCWD, pointer, &metadata, followSymlink ? 0 : AT_SYMLINK_NOFOLLOW)
  }
  guard status == 0 else {
    try fail("The publisher cannot inspect \(path).")
  }
  return metadata
}

private func requireTrustedFile(
  _ path: String,
  executable: Bool,
  testingOwnerAllowed: Bool = false
) throws {
  let canonical = try canonicalExistingPath(path, label: "trusted publisher file")
  guard canonical == path else {
    try fail("Trusted publisher files must use canonical non-symlink paths.")
  }
  let link = try fileMetadata(path)
  let metadata = try fileMetadata(path, followSymlink: true)
  guard (link.st_mode & S_IFMT) != S_IFLNK,
    (metadata.st_mode & S_IFMT) == S_IFREG,
    metadata.st_nlink == 1,
    metadata.st_mode & 0o022 == 0,
    !executable || metadata.st_mode & 0o111 != 0
  else {
    try fail("A trusted publisher file has unsafe type or permissions.")
  }
  #if RELEASE_TAG_PUBLISHER_HOST_TESTING
    let allowedOwners: Set<uid_t> = testingOwnerAllowed ? [0, getuid()] : [0]
  #else
    let allowedOwners: Set<uid_t> = [0]
  #endif
  guard allowedOwners.contains(metadata.st_uid) else {
    try fail("A trusted publisher file has an unapproved owner.")
  }
}

private func requireTrustedParents(_ path: String, testingOwnerAllowed: Bool) throws {
  var current = URL(fileURLWithPath: path).deletingLastPathComponent().path
  while true {
    let metadata = try fileMetadata(current, followSymlink: true)
    guard (metadata.st_mode & S_IFMT) == S_IFDIR, metadata.st_mode & 0o022 == 0 else {
      try fail("Publisher parent \(current) has unsafe ownership or permissions.")
    }
    #if RELEASE_TAG_PUBLISHER_HOST_TESTING
      let allowedOwners: Set<uid_t> = testingOwnerAllowed ? [0, getuid()] : [0]
    #else
      let allowedOwners: Set<uid_t> = [0]
    #endif
    guard allowedOwners.contains(metadata.st_uid) else {
      try fail("Publisher parent \(current) has an unapproved owner.")
    }
    let parent = URL(fileURLWithPath: current).deletingLastPathComponent().path
    if parent == current { break }
    current = parent
  }
}

private func readBoundedFile(_ path: String, maximumBytes: Int) throws -> Data {
  let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
  defer { handle.closeFile() }
  let data = handle.readData(ofLength: maximumBytes + 1)
  guard !data.isEmpty, data.count <= maximumBytes else {
    try fail("A publisher file is empty or exceeds its size limit.")
  }
  return data
}

private func sha256(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func nativePairSha256(_ binding: PublisherBinding) -> String {
  sha256(Data([
    "freed-release-tag-publisher-native-pair-v2",
    binding.publisherPath,
    binding.publisherSha256,
    binding.publisherCdHash,
    binding.provisionerPath,
    binding.provisionerSha256,
    binding.provisionerCdHash,
    "",
  ].joined(separator: "\n").utf8))
}

private func codeHash(_ information: CFDictionary?) throws -> String {
  guard let dictionary = information as? [CFString: Any],
    let value = dictionary[kSecCodeInfoUnique] as? Data,
    value.count >= 20, value.count <= 32
  else { try fail("A publisher code signature has no canonical CDHash.") }
  return value.map { String(format: "%02x", $0) }.joined()
}

private func requireHardenedRuntimeFlags(
  _ information: CFDictionary?,
  label: String
) throws {
  guard let dictionary = information as? [CFString: Any],
    let flags = dictionary[kSecCodeInfoFlags] as? NSNumber,
    flags.uint32Value & requiredRuntimeSignatureFlag == requiredRuntimeSignatureFlag
  else {
    try fail("The \(label) is not protected by the hardened runtime.")
  }
}

private func requireLiveHardenedRuntimeStatus(
  _ information: CFDictionary?,
  label: String
) throws {
  guard let dictionary = information as? [CFString: Any],
    let status = dictionary[kSecCodeInfoStatus] as? NSNumber,
    status.uint32Value & requiredRuntimeSignatureFlag == requiredRuntimeSignatureFlag
  else {
    try fail("The live \(label) does not have the hardened runtime kernel status.")
  }
}

private func liveCodeSigningInformation(_ code: SecCode) throws -> CFDictionary {
  // Security.framework documents Code and StaticCode inputs, but Swift imports
  // this C API with the narrower SecStaticCode type.
  let dynamicCode = unsafeBitCast(code, to: SecStaticCode.self)
  var information: CFDictionary?
  guard SecCodeCopySigningInformation(
    dynamicCode,
    SecCSFlags(rawValue: kSecCSSigningInformation | kSecCSDynamicInformation),
    &information
  ) == errSecSuccess, let information else {
    try fail("The live publisher code status cannot be inspected.")
  }
  return information
}

private func runningCodeHash() throws -> String {
  var code: SecCode?
  guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code else {
    try fail("The running publisher code identity is unavailable.")
  }
  guard SecCodeCheckValidity(
    code,
    SecCSFlags(rawValue: kSecCSStrictValidate),
    nil
  ) == errSecSuccess else {
    try fail("The running publisher code signature is invalid.")
  }
  let liveInformation = try liveCodeSigningInformation(code)
  try requireHardenedRuntimeFlags(liveInformation, label: "live publisher")
  try requireLiveHardenedRuntimeStatus(liveInformation, label: "publisher")
  let liveHash = try codeHash(liveInformation)
  var staticCode: SecStaticCode?
  guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
    let staticCode
  else { try fail("The running publisher static code identity is unavailable.") }
  var information: CFDictionary?
  guard SecCodeCopySigningInformation(
    staticCode,
    SecCSFlags(rawValue: kSecCSSigningInformation),
    &information
  ) == errSecSuccess else {
    try fail("The running publisher code identity cannot be inspected.")
  }
  try requireHardenedRuntimeFlags(
    information,
    label: "kernel-validated publisher static code")
  let staticHash = try codeHash(information)
  guard liveHash == staticHash else {
    try fail("The live publisher identity does not match its static code.")
  }
  return liveHash
}

private func staticCodeHash(_ path: String) throws -> String {
  var code: SecStaticCode?
  guard SecStaticCodeCreateWithPath(
    URL(fileURLWithPath: path) as CFURL,
    SecCSFlags(),
    &code
  ) == errSecSuccess, let code else {
    try fail("A bound publisher code identity is unavailable.")
  }
  guard SecStaticCodeCheckValidity(
    code,
    SecCSFlags(rawValue: kSecCSStrictValidate),
    nil
  ) == errSecSuccess else {
    try fail("A bound publisher code signature is invalid.")
  }
  var information: CFDictionary?
  guard SecCodeCopySigningInformation(
    code,
    SecCSFlags(rawValue: kSecCSSigningInformation),
    &information
  ) == errSecSuccess else {
    try fail("A bound publisher code identity cannot be inspected.")
  }
  try requireHardenedRuntimeFlags(information, label: "bound publisher static code")
  return try codeHash(information)
}

private func validateLowercaseHex(_ value: String, count: Int, label: String) throws {
  guard value.count == count,
    value.unicodeScalars.allSatisfy({
      ($0.value >= 48 && $0.value <= 57) || ($0.value >= 97 && $0.value <= 102)
    })
  else {
    try fail("The \(label) must be \(count) lowercase hexadecimal characters.")
  }
}

private func loadBinding(_ path: String) throws -> PublisherBinding {
  #if RELEASE_TAG_PUBLISHER_HOST_TESTING
    let testing = path != productionConfigPath
  #else
    let testing = false
  #endif
  try requireTrustedFile(path, executable: false, testingOwnerAllowed: testing)
  try requireTrustedParents(path, testingOwnerAllowed: testing)
  let data = try readBoundedFile(path, maximumBytes: maximumConfigBytes)
  let object = try JSONSerialization.jsonObject(with: data)
  let expectedKeys: Set<String> = [
    "schemaVersion", "purpose", "status", "repo", "appId", "appSlug",
    "publisherPath", "publisherSha256", "publisherCdHash", "provisionerPath",
    "provisionerSha256", "provisionerCdHash", "nativePairSha256",
  ]
  guard let dictionary = object as? [String: Any], Set(dictionary.keys) == expectedKeys else {
    try fail("The publisher binding contains unsupported or missing fields.")
  }
  let binding: PublisherBinding
  do {
    binding = try JSONDecoder().decode(PublisherBinding.self, from: data)
  } catch {
    try fail("The publisher binding has invalid field types.")
  }
  guard binding.schemaVersion == 3,
    binding.purpose == "freed-release-tag-publisher-binding",
    binding.status == "active",
    binding.repo == "freed-project/freed",
    binding.appId == 4_296_969,
    binding.appSlug == "freed-release-publisher"
  else {
    try fail("The publisher binding identity is invalid.")
  }
  try validateLowercaseHex(binding.publisherSha256, count: 64, label: "publisher digest")
  guard (40...64).contains(binding.publisherCdHash.count) else {
    try fail("The publisher CDHash has an invalid length.")
  }
  try validateLowercaseHex(
    binding.publisherCdHash,
    count: binding.publisherCdHash.count,
    label: "publisher CDHash")
  try validateLowercaseHex(
    binding.provisionerSha256, count: 64, label: "publisher provisioner digest")
  guard (40...64).contains(binding.provisionerCdHash.count) else {
    try fail("The publisher provisioner CDHash has an invalid length.")
  }
  try validateLowercaseHex(
    binding.provisionerCdHash,
    count: binding.provisionerCdHash.count,
    label: "publisher provisioner CDHash")
  try validateLowercaseHex(
    binding.nativePairSha256, count: 64, label: "publisher native pair digest")
  guard nativePairSha256(binding) == binding.nativePairSha256 else {
    try fail("The publisher native pair digest is invalid.")
  }
  return binding
}

private func validateBinding(
  _ binding: PublisherBinding,
  parsed: ParsedCommand
) throws -> NativePairIdentity {
  let executable = try currentExecutablePath()
  #if RELEASE_TAG_PUBLISHER_HOST_TESTING
    let testing = parsed.configPath != productionConfigPath
  #else
    let testing = false
  #endif
  try requireTrustedFile(executable, executable: true, testingOwnerAllowed: testing)
  try requireTrustedParents(executable, testingOwnerAllowed: testing)
  let boundPublisher = try canonicalExistingPath(binding.publisherPath, label: "bound publisher")
  guard executable == boundPublisher else {
    try fail("The running publisher does not match the bound publisher path.")
  }
  let publisherDigest = sha256(
    try readBoundedFile(executable, maximumBytes: 64 * 1_024 * 1_024))
  guard publisherDigest == binding.publisherSha256 else {
    try fail("The running publisher does not match the bound publisher digest.")
  }
  let kernelPublisherCdHash = try runningCodeHash()
  let staticPublisherCdHash = try staticCodeHash(boundPublisher)
  guard kernelPublisherCdHash == binding.publisherCdHash,
    staticPublisherCdHash == binding.publisherCdHash
  else {
    try fail("The mapped publisher code does not match the bound static code identity.")
  }
  let boundProvisioner = try canonicalExistingPath(
    binding.provisionerPath, label: "bound publisher provisioner")
  #if !RELEASE_TAG_PUBLISHER_HOST_TESTING
    guard boundProvisioner == productionProvisionerPath else {
      try fail("The publisher provisioner does not use its fixed production path.")
    }
  #endif
  try requireTrustedFile(
    boundProvisioner, executable: true, testingOwnerAllowed: testing)
  try requireTrustedParents(boundProvisioner, testingOwnerAllowed: testing)
  let provisionerDigest = sha256(
    try readBoundedFile(boundProvisioner, maximumBytes: 64 * 1_024 * 1_024))
  guard provisionerDigest == binding.provisionerSha256 else {
    try fail("The publisher provisioner does not match the bound provisioner digest.")
  }
  let staticProvisionerCdHash = try staticCodeHash(boundProvisioner)
  guard staticProvisionerCdHash == binding.provisionerCdHash else {
    try fail("The publisher provisioner does not match its bound static code identity.")
  }
  guard parsed.values["--repo"] == binding.repo else {
    try fail("Publisher arguments do not match the root-owned App binding.")
  }
  if parsed.name != "publish" {
    guard parsed.values["--app-id"] == String(binding.appId),
      parsed.values["--app-slug"] == binding.appSlug
    else {
      try fail("Publisher arguments do not match the root-owned App binding.")
    }
  }
  return NativePairIdentity(
    publisherSha256: publisherDigest,
    publisherCdHash: kernelPublisherCdHash,
    provisionerSha256: provisionerDigest,
    provisionerCdHash: staticProvisionerCdHash,
    nativePairSha256: binding.nativePairSha256
  )
}

private func trustedApplicationData(_ path: String) throws -> Data {
  var application: SecTrustedApplication?
  guard path.withCString({ SecTrustedApplicationCreateFromPath($0, &application) })
    == errSecSuccess, let application
  else { try fail("A publisher Keychain application identity could not be created.") }
  var data: CFData?
  guard SecTrustedApplicationCopyData(application, &data) == errSecSuccess, let data else {
    try fail("A publisher Keychain application identity is unreadable.")
  }
  return data as Data
}

private func exactKeychainACL(
  _ item: SecKeychainItem,
  host: String,
  provisioner: String
) throws -> Bool {
  var access: SecAccess?
  guard SecKeychainItemCopyAccess(item, &access) == errSecSuccess, let access else {
    try fail("The release App Keychain ACL is unavailable.")
  }
  let expected = Set(try [host, provisioner].map(trustedApplicationData))
  guard expected.count == 2,
    let aclList = SecAccessCopyMatchingACLList(
      access,
      kSecACLAuthorizationDecrypt
    ) as? [SecACL], !aclList.isEmpty
  else { return false }
  for acl in aclList {
    var applications: CFArray?
    var description: CFString?
    var selector = SecKeychainPromptSelector()
    guard SecACLCopyContents(acl, &applications, &description, &selector) == errSecSuccess,
      let applications = applications as? [SecTrustedApplication],
      applications.count == 2,
      selector == SecKeychainPromptSelector()
    else { return false }
    let actual = Set(try applications.map { application in
      var data: CFData?
      guard SecTrustedApplicationCopyData(application, &data) == errSecSuccess,
        let data
      else { try fail("A release App Keychain ACL identity is unreadable.") }
      return data as Data
    })
    guard actual.count == 2, actual == expected else { return false }
  }
  return true
}

private func uniqueKeychainItem(host: String, provisioner: String) throws -> SecKeychainItem {
  let referenceQuery: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: keychainService,
    kSecAttrAccount: keychainAccount,
    kSecReturnRef: true,
    kSecMatchLimit: kSecMatchLimitAll,
    kSecUseAuthenticationUI: kSecUseAuthenticationUIFail,
  ]
  var reference: CFTypeRef?
  let referenceStatus = SecItemCopyMatching(referenceQuery as CFDictionary, &reference)
  guard referenceStatus == errSecSuccess,
    let items = reference as? [SecKeychainItem],
    items.count == 1,
    let item = items.first
  else {
    try fail("The release GitHub App private key must be one unique Keychain item.")
  }
  guard try exactKeychainACL(item, host: host, provisioner: provisioner) else {
    try fail("The release App key ACL does not match the exact bound native pair.")
  }
  return item
}

private func readKeychainSecret(host: String, provisioner: String) throws -> Data {
  let item = try uniqueKeychainItem(host: host, provisioner: provisioner)
  var length: UInt32 = 0
  var content: UnsafeMutableRawPointer?
  let copyStatus = SecKeychainItemCopyContent(
    item,
    nil,
    nil,
    &length,
    &content
  )
  guard copyStatus == errSecSuccess, let content else {
    try fail("The release GitHub App private key is unavailable in Keychain.")
  }
  defer {
    _ = memset_s(content, Int(length), 0, Int(length))
    SecKeychainItemFreeContent(nil, content)
  }
  guard length > 0, length <= UInt32(maximumKeyBytes) else {
    try fail("The release GitHub App private key is empty or oversized.")
  }
  var secret = Data(count: Int(length))
  secret.withUnsafeMutableBytes { destination in
    destination.baseAddress?.copyMemory(from: content, byteCount: Int(length))
  }
  do {
    guard try exactKeychainACL(item, host: host, provisioner: provisioner) else {
      try fail("The release App key ACL changed while its secret was being read.")
    }
    return secret
  } catch {
    secret.resetBytes(in: 0..<secret.count)
    throw error
  }
}

private func readPrivateKey(_ parsed: ParsedCommand, binding: PublisherBinding) throws -> Data {
  #if RELEASE_TAG_PUBLISHER_HOST_TESTING
    if let path = parsed.testKeyFile {
      let canonical = try canonicalExistingPath(path, label: "testing private key")
      guard canonical == path else { try fail("The testing private key path must be canonical.") }
      let metadata = try fileMetadata(path, followSymlink: true)
      guard (metadata.st_mode & S_IFMT) == S_IFREG,
        metadata.st_uid == getuid(),
        metadata.st_mode & 0o077 == 0
      else {
        try fail("The testing private key must be a private file owned by the current user.")
      }
      return try readBoundedFile(path, maximumBytes: maximumKeyBytes)
    }
  #endif
  return try readKeychainSecret(
    host: binding.publisherPath,
    provisioner: binding.provisionerPath)
}

private func privateRSAKey(from pem: inout Data) throws -> SecKey {
  guard !pem.isEmpty, pem.count <= maximumKeyBytes else {
    try fail("The release App key is empty or oversized.")
  }
  let begin = Data("-----BEGIN RSA PRIVATE KEY-----".utf8)
  let end = Data("-----END RSA PRIVATE KEY-----".utf8)
  guard pem.starts(with: begin) else {
    try fail("The release App key must use PKCS1 RSA PRIVATE KEY PEM.")
  }
  var bodyStart = begin.count
  if pem.count >= bodyStart + 2, pem[bodyStart] == 0x0d, pem[bodyStart + 1] == 0x0a {
    bodyStart += 2
  } else if pem.count > bodyStart, pem[bodyStart] == 0x0a {
    bodyStart += 1
  } else {
    try fail("The release App PKCS1 header must end with a newline.")
  }
  var terminalNewlineBytes = 0
  if pem.last == 0x0a {
    terminalNewlineBytes = pem.count >= 2 && pem[pem.count - 2] == 0x0d ? 2 : 1
  }
  guard pem.count >= bodyStart + end.count + terminalNewlineBytes else {
    try fail("The release App key must use PKCS1 RSA PRIVATE KEY PEM.")
  }
  let footerStart = pem.count - terminalNewlineBytes - end.count
  guard footerStart > bodyStart,
    pem[footerStart..<(footerStart + end.count)].elementsEqual(end)
  else { try fail("The release App key must use PKCS1 RSA PRIVATE KEY PEM.") }
  var encoded = Data()
  encoded.reserveCapacity(footerStart - bodyStart)
  defer { encoded.resetBytes(in: 0..<encoded.count) }
  for byte in pem[bodyStart..<footerStart] {
    switch byte {
    case 0x41...0x5a, 0x61...0x7a, 0x30...0x39, 0x2b, 0x2f, 0x3d:
      encoded.append(byte)
    case 0x0a, 0x0d:
      continue
    default:
      try fail("The release App PKCS1 key body contains invalid characters.")
    }
  }
  guard !encoded.isEmpty, var der = Data(base64Encoded: encoded) else {
    try fail("The release App PKCS1 key body is invalid base64.")
  }
  defer { der.resetBytes(in: 0..<der.count) }
  let attributes: [CFString: Any] = [
    kSecAttrKeyType: kSecAttrKeyTypeRSA,
    kSecAttrKeyClass: kSecAttrKeyClassPrivate,
  ]
  var error: Unmanaged<CFError>?
  guard let key = SecKeyCreateWithData(der as CFData, attributes as CFDictionary, &error) else {
    try fail("The release App PKCS1 key cannot be imported.")
  }
  guard let details = SecKeyCopyAttributes(key) as? [CFString: Any],
    let bits = details[kSecAttrKeySizeInBits] as? Int,
    bits >= 2048
  else {
    try fail("The release App RSA key must contain at least 2,048 bits.")
  }
  return key
}

private func base64URL(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

private func canonicalJSON(_ object: Any) throws -> Data {
  try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
}

private func appJWT(appId: Int, privateKey: SecKey) throws -> String {
  let now = Int(Date().timeIntervalSince1970)
  let header = try canonicalJSON(["alg": "RS256", "typ": "JWT"])
  let payload = try canonicalJSON(["exp": now + 540, "iat": now - 30, "iss": appId])
  let signingInput = "\(base64URL(header)).\(base64URL(payload))"
  var error: Unmanaged<CFError>?
  guard let signature = SecKeyCreateSignature(
    privateKey,
    .rsaSignatureMessagePKCS1v15SHA256,
    Data(signingInput.utf8) as CFData,
    &error
  ) as Data? else {
    try fail("The release App JWT could not be signed.")
  }
  return "\(signingInput).\(base64URL(signature))"
}

private final class GitHubClient: @unchecked Sendable {
  private let baseURL: URL
  private let session: URLSession

  init(base: String) throws {
    guard let url = URL(string: base), url.host != nil else {
      try fail("The GitHub API base is invalid.")
    }
    baseURL = url
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = requestTimeout
    configuration.timeoutIntervalForResource = requestTimeout
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    session = URLSession(configuration: configuration)
  }

  func request(
    method: String,
    path: String,
    token: String,
    body: Any? = nil,
    accepted: Set<Int>
  ) throws -> HTTPResponse {
    guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
      try fail("The GitHub API base cannot be resolved.")
    }
    let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    components.path = baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      .isEmpty ? String(parts[0]) : baseURL.path + String(parts[0])
    if parts.count == 2 { components.percentEncodedQuery = String(parts[1]) }
    guard let url = components.url else { try fail("A GitHub API request URL is invalid.") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = requestTimeout
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
    request.setValue("Freed-Release-Tag-Publisher", forHTTPHeaderField: "User-Agent")
    if let body {
      request.httpBody = try canonicalJSON(body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let semaphore = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var responseData: Data?
    var responseValue: URLResponse?
    var responseError: Error?
    let task = session.dataTask(with: request) { data, response, error in
      lock.lock()
      responseData = data
      responseValue = response
      responseError = error
      lock.unlock()
      semaphore.signal()
    }
    task.resume()
    guard semaphore.wait(timeout: .now() + requestTimeout + 2) == .success else {
      task.cancel()
      try fail("A GitHub API request timed out.")
    }
    lock.lock()
    let data = responseData ?? Data()
    let response = responseValue
    let error = responseError
    lock.unlock()
    if error != nil { try fail("A GitHub API request failed before receiving a response.") }
    guard let http = response as? HTTPURLResponse else {
      try fail("A GitHub API request returned no HTTP response.")
    }
    guard accepted.contains(http.statusCode) else {
      try fail("GitHub API request \(method) \(path.split(separator: "?")[0]) returned HTTP \(http.statusCode).")
    }
    return HTTPResponse(status: http.statusCode, data: data)
  }
}

private func jsonObject(_ data: Data, label: String) throws -> [String: Any] {
  guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    try fail("The \(label) response is not a JSON object.")
  }
  return object
}

private func installationContext(
  binding: PublisherBinding,
  key: SecKey,
  client: GitHubClient
) throws -> InstallationContext {
  let jwt = try appJWT(appId: binding.appId, privateKey: key)
  let appResponse = try client.request(method: "GET", path: "/app", token: jwt, accepted: [200])
  let app = try jsonObject(appResponse.data, label: "GitHub App")
  let expectedAppPermissions = ["contents": "write", "metadata": "read"]
  guard app["id"] as? Int == binding.appId,
    app["slug"] as? String == binding.appSlug,
    app["name"] as? String == "Freed Release Publisher",
    app["external_url"] as? String == "https://freed.wtf",
    app["events"] as? [String] == [],
    app["permissions"] as? [String: String] == expectedAppPermissions,
    let owner = app["owner"] as? [String: Any],
    owner["login"] as? String == "freed-project",
    owner["type"] as? String == "Organization"
  else {
    try fail("The Keychain key does not authenticate the exact private Freed Release Publisher App.")
  }

  let installationResponse = try client.request(
    method: "GET",
    path: "/repos/\(binding.repo)/installation",
    token: jwt,
    accepted: [200]
  )
  let installation = try jsonObject(installationResponse.data, label: "GitHub App installation")
  guard let installationId = installation["id"] as? Int, installationId > 0,
    let account = installation["account"] as? [String: Any],
    let accountLogin = account["login"] as? String,
    accountLogin == "freed-project",
    let accountType = account["type"] as? String,
    accountType == "Organization",
    let selection = installation["repository_selection"] as? String,
    selection == "selected",
    let permissions = installation["permissions"] as? [String: String],
    permissions == ["contents": "write", "metadata": "read"],
    installation["suspended_at"] is NSNull || installation["suspended_at"] == nil
  else {
    try fail("The release App installation must be active, selected-repository only, and have exactly Contents write plus Metadata read.")
  }

  let repositoryName = binding.repo.split(separator: "/").last.map(String.init) ?? ""
  let tokenResponse = try client.request(
    method: "POST",
    path: "/app/installations/\(installationId)/access_tokens",
    token: jwt,
    body: [
      "repositories": [repositoryName],
      "permissions": ["contents": "write"],
    ],
    accepted: [201]
  )
  let tokenObject = try jsonObject(tokenResponse.data, label: "installation token")
  guard let token = tokenObject["token"] as? String, token.count >= 20 else {
    try fail("GitHub did not return a usable short-lived installation token.")
  }
  do {
    let repositoriesResponse = try client.request(
      method: "GET",
      path: "/installation/repositories?per_page=100",
      token: token,
      accepted: [200]
    )
    let repositoriesObject = try jsonObject(
      repositoriesResponse.data,
      label: "installation repositories"
    )
    let repositoryNames = (repositoriesObject["repositories"] as? [[String: Any]] ?? [])
      .compactMap { $0["full_name"] as? String }
      .sorted()
    guard repositoriesObject["total_count"] as? Int == 1,
      repositoryNames == [binding.repo]
    else {
      try fail("The scoped installation token does not expose exactly the bound repository.")
    }
    return InstallationContext(
      readiness: InstallationReadiness(
        schemaVersion: 1,
        purpose: "freed-release-tag-publisher-installation-readiness",
        repo: binding.repo,
        appId: binding.appId,
        appSlug: binding.appSlug,
        appName: "Freed Release Publisher",
        appExternalUrl: "https://freed.wtf",
        appOwnerLogin: "freed-project",
        appOwnerType: "Organization",
        appPermissions: expectedAppPermissions,
        appEvents: [],
        installationId: installationId,
        accountLogin: accountLogin,
        accountType: accountType,
        repositorySelection: selection,
        permissions: permissions,
        repositories: repositoryNames
      ),
      token: token
    )
  } catch {
    _ = try? client.request(
      method: "DELETE", path: "/installation/token", token: token, accepted: [204])
    throw error
  }
}

private func revokeToken(_ context: inout InstallationContext, client: GitHubClient) throws {
  let token = context.token
  _ = try client.request(
    method: "DELETE", path: "/installation/token", token: token, accepted: [204])
  context.token = ""
}

private func emitJSON<T: Encodable>(_ value: T) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  FileHandle.standardOutput.write(try encoder.encode(value) + Data([0x0a]))
}

private func runGit(_ arguments: [String], worktree: String, home: String) throws -> String {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
  process.arguments = [
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
    "-c", "credential.helper=", "-C", worktree,
  ] + arguments
  process.currentDirectoryURL = URL(fileURLWithPath: worktree)
  process.environment = [
    "HOME": home,
    "PATH": "/usr/bin:/bin",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
  ]
  let output = Pipe()
  let errors = Pipe()
  process.standardOutput = output
  process.standardError = errors
  do { try process.run() } catch { try fail("The trusted git command could not start.") }
  process.waitUntilExit()
  guard process.terminationStatus == 0 else {
    try fail("A trusted git validation command failed.")
  }
  let data = output.fileHandleForReading.readDataToEndOfFile()
  guard let text = String(data: data, encoding: .utf8) else {
    try fail("A trusted git command returned invalid text.")
  }
  return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func validReleaseTag(_ value: String) -> Bool {
  let suffix = value.hasSuffix("-dev") ? "-dev" : ""
  let numeric = String(value.dropFirst().dropLast(suffix.count))
  guard value.hasPrefix("v"), numeric.split(separator: ".").count == 3 else { return false }
  return numeric.split(separator: ".").allSatisfy { part in
    !part.isEmpty &&
      part.utf8.allSatisfy { $0 >= 48 && $0 <= 57 } &&
      (part.count == 1 || part.first != "0")
  }
}

private func validateReceipt(_ data: Data, tag: String, channel: String) throws {
  let object = try jsonObject(data, label: "release receipt")
  guard object["tag"] as? String == tag,
    object["version"] as? String == String(tag.dropFirst()),
    object["channel"] as? String == channel,
    object["approved"] as? Bool == true,
    let source = object["source"] as? [String: Any],
    source["channel"] as? String == channel
  else {
    try fail("The release receipt does not approve the requested tag and channel.")
  }
}

private func remoteBranchSHA(
  binding: PublisherBinding,
  branch: String,
  token: String,
  client: GitHubClient
) throws -> String {
  let response = try client.request(
    method: "GET",
    path: "/repos/\(binding.repo)/git/ref/heads/\(branch)",
    token: token,
    accepted: [200]
  )
  let object = try jsonObject(response.data, label: "protected branch ref")
  guard let target = object["object"] as? [String: Any],
    let sha = target["sha"] as? String
  else {
    try fail("The protected branch response did not contain a commit SHA.")
  }
  return sha
}

private func remoteReceipt(
  binding: PublisherBinding,
  path: String,
  commit: String,
  token: String,
  client: GitHubClient
) throws -> Data {
  let encodedPath = path.split(separator: "/").map { part in
    String(part).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
  }.joined(separator: "/")
  let response = try client.request(
    method: "GET",
    path: "/repos/\(binding.repo)/contents/\(encodedPath)?ref=\(commit)",
    token: token,
    accepted: [200]
  )
  let object = try jsonObject(response.data, label: "remote release receipt")
  guard object["encoding"] as? String == "base64",
    let encoded = object["content"] as? String,
    let data = Data(base64Encoded: encoded.filter { !$0.isWhitespace })
  else {
    try fail("The remote release receipt is not canonical base64 content.")
  }
  return data
}

private func verifyAnnotatedTag(
  binding: PublisherBinding,
  tag: String,
  commit: String,
  expectedTagObjectSHA: String?,
  token: String,
  client: GitHubClient
) throws -> String? {
  let refResponse = try client.request(
    method: "GET",
    path: "/repos/\(binding.repo)/git/ref/tags/\(tag)",
    token: token,
    accepted: [200, 404]
  )
  if refResponse.status == 404 { return nil }
  let refObject = try jsonObject(refResponse.data, label: "release tag ref")
  guard let target = refObject["object"] as? [String: Any],
    target["type"] as? String == "tag",
    let tagObjectSHA = target["sha"] as? String
  else {
    try fail("The release tag ref does not point at one annotated tag object.")
  }
  try validateLowercaseHex(tagObjectSHA, count: 40, label: "annotated tag object SHA")
  if let expectedTagObjectSHA, tagObjectSHA != expectedTagObjectSHA {
    try fail("The created release tag ref does not point at the expected annotated tag object.")
  }
  try verifyAnnotatedTagObject(
    binding: binding,
    tag: tag,
    commit: commit,
    tagObjectSHA: tagObjectSHA,
    token: token,
    client: client
  )
  return tagObjectSHA
}

private func verifyAnnotatedTagObject(
  binding: PublisherBinding,
  tag: String,
  commit: String,
  tagObjectSHA: String,
  token: String,
  client: GitHubClient
) throws {
  try validateLowercaseHex(tagObjectSHA, count: 40, label: "annotated tag object SHA")
  let tagResponse = try client.request(
    method: "GET",
    path: "/repos/\(binding.repo)/git/tags/\(tagObjectSHA)",
    token: token,
    accepted: [200]
  )
  let annotatedTag = try jsonObject(tagResponse.data, label: "annotated release tag")
  guard annotatedTag["tag"] as? String == tag,
    annotatedTag["message"] as? String == "Freed release \(tag)",
    let targetCommit = annotatedTag["object"] as? [String: Any],
    targetCommit["type"] as? String == "commit",
    targetCommit["sha"] as? String == commit
  else {
    try fail("The annotated release tag does not identify the exact approved release.")
  }
}

private func emitPublishResult(
  binding: PublisherBinding,
  tag: String,
  commit: String,
  tagObjectSHA: String,
  recovered: Bool
) throws {
  try emitJSON([
    "schemaVersion": AnyEncodable(1),
    "purpose": AnyEncodable("freed-release-tag-publish-result"),
    "repo": AnyEncodable(binding.repo),
    "tag": AnyEncodable(tag),
    "commit": AnyEncodable(commit),
    "tagObjectSha": AnyEncodable(tagObjectSHA),
    "recovered": AnyEncodable(recovered),
  ])
}

private func publish(
  binding: PublisherBinding,
  parsed: ParsedCommand,
  key: SecKey,
  client: GitHubClient,
  home: String
) throws {
  let values = parsed.values
  guard let worktreeValue = values["--worktree"],
    let tag = values["--tag"],
    let channel = values["--channel"],
    let commit = values["--commit"],
    let branch = values["--branch"],
    let releaseFile = values["--release-file"],
    let releaseDigest = values["--release-file-sha256"]
  else { try fail("The publish request is incomplete.") }
  let worktree = try canonicalExistingPath(worktreeValue, label: "release worktree")
  guard worktree == worktreeValue,
    try canonicalExistingPath(FileManager.default.currentDirectoryPath, label: "caller directory") == worktree
  else {
    try fail("The release publisher must run from the exact canonical release worktree.")
  }
  try validateLowercaseHex(commit, count: 40, label: "release commit")
  try validateLowercaseHex(releaseDigest, count: 64, label: "release receipt digest")
  guard validReleaseTag(tag),
    ["dev", "production"].contains(channel),
    (channel == "dev" ? branch == "dev" && tag.hasSuffix("-dev") : branch == "main" && !tag.hasSuffix("-dev")),
    releaseFile == "release-notes/releases/\(tag).json"
  else {
    try fail("The tag, channel, branch, or release receipt path is invalid.")
  }
  guard try runGit(["rev-parse", "--show-toplevel"], worktree: worktree, home: home) == worktree,
    try runGit(["symbolic-ref", "--short", "HEAD"], worktree: worktree, home: home) == branch,
    try runGit(["rev-parse", "HEAD"], worktree: worktree, home: home) == commit,
    try runGit(["status", "--porcelain", "--untracked-files=all"], worktree: worktree, home: home).isEmpty
  else {
    try fail("The release worktree is not the clean requested protected branch commit.")
  }
  let origin = try runGit(["remote", "get-url", "origin"], worktree: worktree, home: home)
  let approvedOrigins = [
    "https://github.com/\(binding.repo)",
    "https://github.com/\(binding.repo).git",
    "git@github.com:\(binding.repo).git",
  ]
  guard approvedOrigins.contains(origin) else {
    try fail("The release worktree origin does not match the bound GitHub repository.")
  }
  let localReceiptPath = worktree + "/" + releaseFile
  let canonicalReceipt = try canonicalExistingPath(localReceiptPath, label: "release receipt")
  let receiptLink = try fileMetadata(localReceiptPath)
  let receiptMetadata = try fileMetadata(localReceiptPath, followSymlink: true)
  guard canonicalReceipt == localReceiptPath,
    (receiptLink.st_mode & S_IFMT) != S_IFLNK,
    (receiptMetadata.st_mode & S_IFMT) == S_IFREG
  else {
    try fail("The release receipt must be a canonical regular non-symlink file.")
  }
  let localReceipt = try readBoundedFile(localReceiptPath, maximumBytes: 2 * 1_024 * 1_024)
  guard sha256(localReceipt) == releaseDigest else {
    try fail("The local release receipt digest does not match the approved digest.")
  }
  try validateReceipt(localReceipt, tag: tag, channel: channel)

  var context = try installationContext(binding: binding, key: key, client: client)
  do {
    let committedReceipt = try remoteReceipt(
      binding: binding,
      path: releaseFile,
      commit: commit,
      token: context.token,
      client: client
    )
    guard sha256(committedReceipt) == releaseDigest else {
      try fail("The committed remote release receipt digest does not match the approved digest.")
    }
    try validateReceipt(committedReceipt, tag: tag, channel: channel)

    if let recoveredTagObjectSHA = try verifyAnnotatedTag(
      binding: binding,
      tag: tag,
      commit: commit,
      expectedTagObjectSHA: nil,
      token: context.token,
      client: client
    ) {
      try revokeToken(&context, client: client)
      try emitPublishResult(
        binding: binding,
        tag: tag,
        commit: commit,
        tagObjectSHA: recoveredTagObjectSHA,
        recovered: true
      )
      return
    }
    guard try remoteBranchSHA(
      binding: binding, branch: branch, token: context.token, client: client) == commit
    else { try fail("The protected remote branch does not point at the requested release commit.") }
    let tagResponse = try client.request(
      method: "POST",
      path: "/repos/\(binding.repo)/git/tags",
      token: context.token,
      body: [
        "tag": tag,
        "message": "Freed release \(tag)",
        "object": commit,
        "type": "commit",
      ],
      accepted: [201]
    )
    let tagObject = try jsonObject(tagResponse.data, label: "annotated tag")
    guard let tagObjectSHA = tagObject["sha"] as? String else {
      try fail("GitHub did not return the annotated tag object SHA.")
    }
    try validateLowercaseHex(tagObjectSHA, count: 40, label: "annotated tag object SHA")
    try verifyAnnotatedTagObject(
      binding: binding,
      tag: tag,
      commit: commit,
      tagObjectSHA: tagObjectSHA,
      token: context.token,
      client: client
    )
    guard try remoteBranchSHA(
      binding: binding, branch: branch, token: context.token, client: client) == commit
    else { try fail("The protected remote branch changed before tag creation.") }
    _ = try client.request(
      method: "POST",
      path: "/repos/\(binding.repo)/git/refs",
      token: context.token,
      body: ["ref": "refs/tags/\(tag)", "sha": tagObjectSHA],
      accepted: [201]
    )
    guard try verifyAnnotatedTag(
      binding: binding,
      tag: tag,
      commit: commit,
      expectedTagObjectSHA: tagObjectSHA,
      token: context.token,
      client: client
    ) == tagObjectSHA else {
      try fail("The created release tag could not be verified.")
    }
    try revokeToken(&context, client: client)
    try emitPublishResult(
      binding: binding,
      tag: tag,
      commit: commit,
      tagObjectSHA: tagObjectSHA,
      recovered: false
    )
  } catch {
    if !context.token.isEmpty { try? revokeToken(&context, client: client) }
    throw error
  }
}

private func disableCoreDumps() throws {
  var limit = rlimit(rlim_cur: 0, rlim_max: 0)
  guard setrlimit(RLIMIT_CORE, &limit) == 0 else {
    try fail("The publisher could not disable core dumps.")
  }
}

private func clearEnvironment() {
  for name in ProcessInfo.processInfo.environment.keys { unsetenv(name) }
}

private func main() -> Int32 {
  do {
    let rawArguments = Array(CommandLine.arguments.dropFirst())
    let home = NSHomeDirectory()
    _ = umask(0o077)
    try disableCoreDumps()
    clearEnvironment()
    let parsed = try parseCommand(rawArguments)
    let binding = try loadBinding(parsed.configPath)
    let nativePair = try validateBinding(binding, parsed: parsed)
    if parsed.name == "attest" {
      try emitJSON([
        "schemaVersion": AnyEncodable(3),
        "purpose": AnyEncodable("freed-release-tag-publisher-readiness"),
        "repo": AnyEncodable(binding.repo),
        "appId": AnyEncodable(binding.appId),
        "appSlug": AnyEncodable(binding.appSlug),
        "credentialMode": AnyEncodable("short-lived-installation-token"),
        "operations": AnyEncodable(["create-annotated-tag"]),
        "allowsArbitraryRefs": AnyEncodable(false),
        "allowsUpdates": AnyEncodable(false),
        "allowsDeletions": AnyEncodable(false),
        "publisherSha256": AnyEncodable(nativePair.publisherSha256),
        "publisherCdHash": AnyEncodable(nativePair.publisherCdHash),
        "provisionerSha256": AnyEncodable(nativePair.provisionerSha256),
        "provisionerCdHash": AnyEncodable(nativePair.provisionerCdHash),
        "nativePairSha256": AnyEncodable(nativePair.nativePairSha256),
      ])
      return 0
    }
    var secret = try readPrivateKey(parsed, binding: binding)
    defer { secret.resetBytes(in: 0..<secret.count) }
    let key = try privateRSAKey(from: &secret)
    secret.resetBytes(in: 0..<secret.count)
    let client = try GitHubClient(base: parsed.apiBase)

    switch parsed.name {
    case "verify-installation":
      var context = try installationContext(binding: binding, key: key, client: client)
      do {
        try revokeToken(&context, client: client)
        try emitJSON(context.readiness)
      } catch {
        if !context.token.isEmpty { try? revokeToken(&context, client: client) }
        throw error
      }
    case "publish":
      try publish(binding: binding, parsed: parsed, key: key, client: client, home: home)
    default:
      try fail("Unsupported publisher command.")
    }
    return 0
  } catch let error as HostFailure {
    fputs("release-tag-publisher: \(error.description)\n", stderr)
    return 1
  } catch {
    fputs("release-tag-publisher: an unexpected validation error occurred\n", stderr)
    return 1
  }
}

private struct AnyEncodable: Encodable {
  private let encodeValue: (Encoder) throws -> Void
  init<T: Encodable>(_ value: T) { encodeValue = value.encode }
  func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}

exit(main())
