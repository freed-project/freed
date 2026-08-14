//go:build linux

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	bindingSchemaVersion  = 4
	leaseLifetimeMS       = 30 * 60 * 1000
	leaseLifetimeSeconds  = 30 * 60
	maxBindingBytes       = 32 * 1024
	maxControlOutputBytes = 64 * 1024
	maxNodeBytes          = 256 * 1024 * 1024
	maxRuntimeFileBytes   = 16 * 1024 * 1024
	channelFD             = 3
	channelChallengeSize  = 32
	attestationProtocol   = "freed-actor-launcher-readiness-v3"
	attestationPurpose    = "automation-actor-launcher-readiness"
	channelProtocol       = "freed-actor-launcher-channel-v1"
	bindingPurpose        = "automation-actor-launcher"
	bindingHandoff        = "trusted-launcher-channel-to-canonical-lease"
	runtimeProtocol       = "freed-automation-actor-runtime-v4"
)

var (
	buildMode    = "host"
	testingMode  = "false"
	launcherRoot = "/etc/freed/automation-actor-launchers"
	runtimeRoot  = "/opt/freed/automation-actor-runtimes"
	trustedUID   = "0"
	actorLeases  = map[string]string{
		"freed-runtime-observer":       "runtime-observer",
		"freed-stability-controller":   "stability-controller",
		"freed-scaffolding-maintainer": "scaffolding-writer",
		"freed-nightly-runner":         "nightly-writer",
		"freed-release-verifier":       "release-verifier",
	}
	actorAuthorities = map[string]struct {
		observer string
		provider string
	}{
		"freed-runtime-observer":       {observer: "observe-only", provider: "forbidden"},
		"freed-stability-controller":   {observer: "plan-only", provider: "forbidden"},
		"freed-scaffolding-maintainer": {observer: "pr-only", provider: "forbidden"},
		"freed-nightly-runner":         {observer: "merge-safe", provider: "approval-required"},
		"freed-release-verifier":       {observer: "observe-only", provider: "forbidden"},
	}
)

type launcherBinding struct {
	SchemaVersion                     int    `json:"schemaVersion"`
	Actor                             string `json:"actor"`
	Purpose                           string `json:"purpose"`
	Handoff                           string `json:"handoff"`
	AttestationProtocol               string `json:"attestationProtocol"`
	StateRoot                         string `json:"stateRoot"`
	LeaseName                         string `json:"leaseName"`
	MaxLeaseLifetimeMS                int    `json:"maxLeaseLifetimeMs"`
	LauncherPath                      string `json:"launcherPath"`
	LauncherSHA256                    string `json:"launcherSha256"`
	NodePath                          string `json:"nodePath"`
	NodeSHA256                        string `json:"nodeSha256"`
	ControlEntryPath                  string `json:"controlEntryPath"`
	ControlEntrySHA256                string `json:"controlEntrySha256"`
	ActorControlEntryPath             string `json:"actorControlEntryPath"`
	ActorControlEntrySHA256           string `json:"actorControlEntrySha256"`
	ControlLibraryPath                string `json:"controlLibraryPath"`
	ControlLibrarySHA256              string `json:"controlLibrarySha256"`
	ReadinessLibraryPath              string `json:"readinessLibraryPath"`
	ReadinessLibrarySHA256            string `json:"readinessLibrarySha256"`
	KernelGuardContractPath           string `json:"kernelGuardContractPath"`
	KernelGuardContractSHA256         string `json:"kernelGuardContractSha256"`
	OutcomeLedgerRepairContractPath   string `json:"outcomeLedgerRepairContractPath"`
	OutcomeLedgerRepairContractSHA256 string `json:"outcomeLedgerRepairContractSha256"`
	LeaseArchiveHelperPath            string `json:"leaseArchiveHelperPath"`
	LeaseArchiveHelperSHA256          string `json:"leaseArchiveHelperSha256"`
}

type controlLease struct {
	SchemaVersion             int    `json:"schemaVersion"`
	Name                      string `json:"name"`
	Owner                     string `json:"owner"`
	Token                     string `json:"token"`
	ObserverAuthority         string `json:"observerAuthority"`
	ProviderAuthority         string `json:"providerAuthority"`
	CredentialKind            string `json:"credentialKind"`
	LauncherSHA256            string `json:"launcherSha256"`
	ActorRuntimeDigest        string `json:"actorRuntimeDigest"`
	LauncherChannelProtocol   string `json:"launcherChannelProtocol"`
	LauncherAttestationSHA256 string `json:"launcherAttestationSha256"`
	LauncherSessionID         string `json:"launcherSessionId"`
	AcquiredAt                string `json:"acquiredAt"`
	HeartbeatAt               string `json:"heartbeatAt"`
	ExpiresAt                 string `json:"expiresAt"`
	TTLMS                     int    `json:"ttlMs"`
}

type acquireResult struct {
	Acquired          bool            `json:"acquired"`
	Takeover          bool            `json:"takeover"`
	CredentialUpgrade bool            `json:"credentialUpgrade"`
	Lease             controlLease    `json:"lease"`
	Previous          json.RawMessage `json:"previous,omitempty"`
	Recovered         *bool           `json:"recovered,omitempty"`
}

type acquireEnvelope struct {
	OK            bool          `json:"ok"`
	SchemaVersion int           `json:"schemaVersion"`
	Action        string        `json:"action"`
	StateRoot     string        `json:"stateRoot"`
	Result        acquireResult `json:"result"`
}

type releaseResult struct {
	Released bool            `json:"released"`
	Lease    json.RawMessage `json:"lease"`
}

type releaseEnvelope struct {
	OK            bool          `json:"ok"`
	SchemaVersion int           `json:"schemaVersion"`
	Action        string        `json:"action"`
	StateRoot     string        `json:"stateRoot"`
	Result        releaseResult `json:"result"`
}

type showEnvelope struct {
	OK            bool            `json:"ok"`
	SchemaVersion int             `json:"schemaVersion"`
	Action        string          `json:"action"`
	StateRoot     string          `json:"stateRoot"`
	Result        json.RawMessage `json:"result"`
}

type arguments struct {
	mode            string
	actor           string
	stateRoot       string
	leaseName       string
	action          string
	operationID     string
	tokenSHA256     string
	challengeSHA256 string
	controlPID      int
	testBinding     string
	testRuntimeRoot string
}

type operationContext struct {
	id          string
	token       string
	tokenSHA256 string
}

type actorSignalError struct {
	signal syscall.Signal
}

func (failure actorSignalError) Error() string {
	return fmt.Sprintf("the actor host was cancelled by signal %d", failure.signal)
}

type cancellationGuard struct {
	mu        sync.Mutex
	context   context.Context
	cancel    context.CancelFunc
	observed  syscall.Signal
	committed bool
}

func newCancellationGuard() *cancellationGuard {
	ctx, cancel := context.WithCancel(context.Background())
	guard := &cancellationGuard{context: ctx, cancel: cancel}
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		for received := range signals {
			value, ok := received.(syscall.Signal)
			if !ok {
				continue
			}
			guard.mu.Lock()
			if !guard.committed && guard.observed == 0 {
				guard.observed = value
				guard.cancel()
			}
			guard.mu.Unlock()
		}
	}()
	return guard
}

func (guard *cancellationGuard) observedSignal() syscall.Signal {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	return guard.observed
}

func (guard *cancellationGuard) commitHandoff(write func() error) (syscall.Signal, error) {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	if guard.observed != 0 {
		return guard.observed, nil
	}
	if err := write(); err != nil {
		return 0, err
	}
	guard.committed = true
	return 0, nil
}

type processIdentity struct {
	pid           int
	parentPID     int
	uid           int
	path          string
	startIdentity string
}

type boundedBuffer struct {
	bytes.Buffer
	exceeded bool
	limit    int
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	original := len(value)
	remaining := buffer.limit - buffer.Len()
	if remaining <= 0 {
		buffer.exceeded = true
		return original, nil
	}
	if len(value) > remaining {
		value = value[:remaining]
		buffer.exceeded = true
	}
	_, _ = buffer.Buffer.Write(value)
	return original, nil
}

func main() {
	if buildMode == "provisioner" {
		fmt.Fprintln(os.Stderr, "automation-actor-provisioner: legacy credential migration is unavailable on Linux")
		os.Exit(1)
	}
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "automation-actor-host: %s\n", err)
		var cancelled actorSignalError
		if errors.As(err, &cancelled) {
			os.Exit(128 + int(cancelled.signal))
		}
		os.Exit(1)
	}
}

func run() error {
	syscall.Umask(0o077)
	_ = syscall.Setrlimit(syscall.RLIMIT_CORE, &syscall.Rlimit{})
	guard := newCancellationGuard()
	parsed, err := parseArguments(os.Args[1:])
	if err != nil {
		return err
	}
	binding, err := loadBinding(parsed)
	if err != nil {
		return err
	}
	if observed := guard.observedSignal(); observed != 0 {
		return actorSignalError{signal: observed}
	}
	switch parsed.mode {
	case "attest":
		operation, err := newOperation()
		if err != nil {
			return err
		}
		response, err := invokeControl(guard.context, binding, "attest", operation)
		if err != nil {
			if observed := guard.observedSignal(); observed != 0 {
				return actorSignalError{signal: observed}
			}
			return err
		}
		if err := validateReadiness(response, binding); err != nil {
			return err
		}
		observed, err := guard.commitHandoff(func() error {
			_, writeErr := os.Stdout.Write(response)
			return writeErr
		})
		if err != nil {
			return err
		}
		if observed != 0 {
			return actorSignalError{signal: observed}
		}
		return nil
	case "acquire":
		return acquire(binding, guard)
	case "verify":
		attestation, err := verifyChannel(parsed, binding)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(attestation)
	default:
		return errors.New("unsupported host mode")
	}
}

func parseArguments(values []string) (arguments, error) {
	var parsed arguments
	options := map[string]string{}
	testBuild := testingMode == "true"
	for index := 0; index < len(values); index++ {
		value := values[index]
		switch value {
		case "--attest-readiness", "--acquire-lease", "--verify-control-channel":
			if parsed.mode != "" {
				return parsed, errors.New("exactly one actor host mode is required")
			}
			if value == "--attest-readiness" {
				parsed.mode = "attest"
			} else if value == "--acquire-lease" {
				parsed.mode = "acquire"
			} else {
				parsed.mode = "verify"
			}
			continue
		}
		allowed := map[string]bool{
			"--protocol": true, "--actor": true, "--state-root": true,
			"--lease-name": true, "--max-lifetime-ms": true,
			"--ttl-seconds": true, "--channel-action": true,
			"--operation-id": true, "--token-sha256": true,
			"--challenge-sha256": true, "--control-pid": true,
			"--channel-fd": true,
		}
		if testBuild {
			allowed["--test-binding"] = true
			allowed["--test-runtime-root"] = true
		}
		if !allowed[value] || index+1 >= len(values) || options[value] != "" {
			return parsed, errors.New("the actor host received an unsupported or duplicate argument")
		}
		options[value] = values[index+1]
		index++
	}
	parsed.actor = options["--actor"]
	parsed.stateRoot = options["--state-root"]
	parsed.leaseName = options["--lease-name"]
	parsed.testBinding = options["--test-binding"]
	parsed.testRuntimeRoot = options["--test-runtime-root"]
	testOptionCount := 0
	if testBuild {
		if !filepath.IsAbs(parsed.testBinding) || !filepath.IsAbs(parsed.testRuntimeRoot) {
			return parsed, errors.New("the actor host test roots are invalid")
		}
		testOptionCount = 2
	} else if parsed.testBinding != "" || parsed.testRuntimeRoot != "" {
		return parsed, errors.New("the production actor host rejects test-only roots")
	}
	canonicalLease, ok := actorLeases[parsed.actor]
	if parsed.mode == "" || !ok || parsed.leaseName != canonicalLease || parsed.stateRoot == "" {
		return parsed, errors.New("the actor host request identity is incomplete or noncanonical")
	}
	switch parsed.mode {
	case "attest":
		if options["--protocol"] != attestationProtocol || options["--max-lifetime-ms"] != strconv.Itoa(leaseLifetimeMS) || len(options) != 5+testOptionCount {
			return parsed, errors.New("the actor readiness request is invalid")
		}
	case "acquire":
		if options["--ttl-seconds"] != strconv.Itoa(leaseLifetimeSeconds) || len(options) != 4+testOptionCount {
			return parsed, errors.New("the actor lease request must use exactly 1,800 seconds")
		}
	case "verify":
		parsed.action = options["--channel-action"]
		parsed.operationID = options["--operation-id"]
		parsed.tokenSHA256 = options["--token-sha256"]
		parsed.challengeSHA256 = options["--challenge-sha256"]
		parsed.controlPID, _ = strconv.Atoi(options["--control-pid"])
		if options["--protocol"] != channelProtocol ||
			(parsed.action != "attest" && parsed.action != "acquire") ||
			!validUUID(parsed.operationID) || !isDigest(parsed.tokenSHA256) ||
			!isDigest(parsed.challengeSHA256) || parsed.controlPID <= 0 ||
			options["--ttl-seconds"] != strconv.Itoa(leaseLifetimeSeconds) ||
			options["--channel-fd"] != strconv.Itoa(channelFD) || len(options) != 11+testOptionCount {
			return parsed, errors.New("the actor control channel request is invalid")
		}
	}
	return parsed, nil
}

func loadBinding(parsed arguments) (launcherBinding, error) {
	var binding launcherBinding
	uid, err := strconv.Atoi(trustedUID)
	if err != nil || uid < 0 {
		return binding, errors.New("the compiled trusted owner is invalid")
	}
	activeLauncherRoot := launcherRoot
	activeRuntimeRoot := runtimeRoot
	bindingPath := filepath.Join(activeLauncherRoot, parsed.actor+".json")
	if testingMode == "true" {
		activeLauncherRoot = filepath.Dir(parsed.testBinding)
		activeRuntimeRoot = parsed.testRuntimeRoot
		bindingPath = parsed.testBinding
	}
	content, err := readProtectedFile(bindingPath, activeLauncherRoot, uid, false, maxBindingBytes)
	if err != nil {
		return binding, fmt.Errorf("the actor launcher binding is unsafe: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&binding); err != nil {
		return binding, errors.New("the actor launcher binding is invalid")
	}
	if err := requireJSONEnd(decoder); err != nil {
		return binding, err
	}
	if binding.SchemaVersion != bindingSchemaVersion || binding.Actor != parsed.actor ||
		binding.Purpose != bindingPurpose || binding.Handoff != bindingHandoff ||
		binding.AttestationProtocol != attestationProtocol || binding.StateRoot != parsed.stateRoot ||
		binding.LeaseName != parsed.leaseName || binding.MaxLeaseLifetimeMS != leaseLifetimeMS {
		return binding, errors.New("the actor launcher binding does not match this request")
	}
	digest := runtimeDigest(binding)
	if !isDigest(binding.LauncherSHA256) ||
		binding.LauncherPath != filepath.Join(activeLauncherRoot, "bin", parsed.actor+"-"+binding.LauncherSHA256) {
		return binding, errors.New("the actor launcher identity is invalid")
	}
	executablePath, err := os.Executable()
	if err != nil {
		return binding, errors.New("the running actor launcher identity is unavailable")
	}
	executablePath, err = filepath.EvalSymlinks(executablePath)
	if err != nil || executablePath != binding.LauncherPath {
		return binding, errors.New("the actor launcher path does not match the running executable")
	}
	runtimeDirectory := filepath.Join(activeRuntimeRoot, digest)
	expected := map[string]string{
		binding.NodePath:                        filepath.Join(runtimeDirectory, "node"),
		binding.ControlEntryPath:                filepath.Join(runtimeDirectory, "automation-control.mjs"),
		binding.ActorControlEntryPath:           filepath.Join(runtimeDirectory, "automation-actor-control.mjs"),
		binding.ControlLibraryPath:              filepath.Join(runtimeDirectory, "lib", "automation-control.mjs"),
		binding.ReadinessLibraryPath:            filepath.Join(runtimeDirectory, "lib", "automation-actor-readiness.mjs"),
		binding.KernelGuardContractPath:         filepath.Join(runtimeDirectory, "lib", "automation-kernel-guard-contract.mjs"),
		binding.OutcomeLedgerRepairContractPath: filepath.Join(runtimeDirectory, "lib", "outcome-ledger-repair-contract.mjs"),
		binding.LeaseArchiveHelperPath:          filepath.Join(runtimeDirectory, "lib", "lease-archive-move.py"),
	}
	for actual, wanted := range expected {
		if actual != wanted {
			return binding, errors.New("the installed actor runtime layout is invalid")
		}
	}
	artifacts := []struct {
		path, root, digest string
		executable         bool
		maxBytes           int64
	}{
		{binding.LauncherPath, activeLauncherRoot, binding.LauncherSHA256, true, maxRuntimeFileBytes},
		{binding.NodePath, activeRuntimeRoot, binding.NodeSHA256, true, maxNodeBytes},
		{binding.ControlEntryPath, activeRuntimeRoot, binding.ControlEntrySHA256, false, maxRuntimeFileBytes},
		{binding.ActorControlEntryPath, activeRuntimeRoot, binding.ActorControlEntrySHA256, false, maxRuntimeFileBytes},
		{binding.ControlLibraryPath, activeRuntimeRoot, binding.ControlLibrarySHA256, false, maxRuntimeFileBytes},
		{binding.ReadinessLibraryPath, activeRuntimeRoot, binding.ReadinessLibrarySHA256, false, maxRuntimeFileBytes},
		{binding.KernelGuardContractPath, activeRuntimeRoot, binding.KernelGuardContractSHA256, false, maxRuntimeFileBytes},
		{binding.OutcomeLedgerRepairContractPath, activeRuntimeRoot, binding.OutcomeLedgerRepairContractSHA256, false, maxRuntimeFileBytes},
		{binding.LeaseArchiveHelperPath, activeRuntimeRoot, binding.LeaseArchiveHelperSHA256, false, maxRuntimeFileBytes},
	}
	for _, artifact := range artifacts {
		if !isDigest(artifact.digest) {
			return binding, errors.New("the actor runtime contains an invalid digest")
		}
		value, err := readProtectedFile(artifact.path, artifact.root, uid, artifact.executable, artifact.maxBytes)
		if err != nil || digestBytes(value) != artifact.digest {
			return binding, fmt.Errorf("the actor runtime artifact %s changed or is unsafe", filepath.Base(artifact.path))
		}
	}
	if err := requirePhysicalPrivateDirectory(parsed.stateRoot, os.Getuid()); err != nil {
		return binding, fmt.Errorf("the canonical state root is unsafe: %w", err)
	}
	return binding, nil
}

func acquire(binding launcherBinding, guard *cancellationGuard) error {
	operation, err := newOperation()
	if err != nil {
		return err
	}
	var response []byte
	var acquisitionError error
	for attempt := 0; attempt < 2; attempt++ {
		if guard.context.Err() != nil {
			acquisitionError = guard.context.Err()
			break
		}
		response, acquisitionError = invokeControl(guard.context, binding, "acquire", operation)
		if acquisitionError == nil {
			break
		}
	}
	if acquisitionError != nil {
		if cleanupError := releaseAfterAmbiguousAcquire(binding, operation); cleanupError != nil {
			return cleanupError
		}
		if observed := guard.observedSignal(); observed != 0 {
			return actorSignalError{signal: observed}
		}
		return errors.New("the actor lease acquisition failed after exact retries")
	}
	handoff, err := validateLeaseResponse(response, binding, operation)
	if err != nil {
		if cleanupError := releaseAfterAmbiguousAcquire(binding, operation); cleanupError != nil {
			return cleanupError
		}
		return err
	}
	observed, commitError := guard.commitHandoff(func() error {
		return json.NewEncoder(os.Stdout).Encode(handoff)
	})
	if commitError != nil || observed != 0 {
		if cleanupError := releaseAfterAmbiguousAcquire(binding, operation); cleanupError != nil {
			return cleanupError
		}
		if observed != 0 {
			return actorSignalError{signal: observed}
		}
		return commitError
	}
	return nil
}

func invokeControl(parent context.Context, binding launcherBinding, action string, operation operationContext) ([]byte, error) {
	sockets, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("the actor control channel could not be created")
	}
	retained := os.NewFile(uintptr(sockets[0]), "launcher-channel")
	child := os.NewFile(uintptr(sockets[1]), "control-channel")
	defer retained.Close()
	defer child.Close()
	frame := map[string]any{
		"schemaVersion": 1, "action": action,
		"leaseOperationId": operation.id, "leaseToken": operation.token,
	}
	payload, err := json.Marshal(frame)
	if err != nil {
		return nil, errors.New("the actor control frame could not be encoded")
	}
	payload = append(payload, '\n')
	payload = append(payload, channelChallenge(operation)...)
	if _, err := retained.Write(payload); err != nil {
		return nil, errors.New("the actor control frame could not be written")
	}
	_ = syscall.Shutdown(sockets[0], syscall.SHUT_WR)
	deadline, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()
	arguments := []string{
		binding.ActorControlEntryPath,
		"--action", action,
		"--actor", binding.Actor,
		"--state-root", binding.StateRoot,
		"--lease-name", binding.LeaseName,
		"--ttl-seconds", strconv.Itoa(leaseLifetimeSeconds),
		"--challenge-sha256", digestBytes(channelChallenge(operation)),
	}
	if testingMode == "true" {
		arguments = append(arguments,
			"--test-binding", filepath.Join(filepath.Dir(filepath.Dir(binding.LauncherPath)), binding.Actor+".json"),
			"--test-runtime-root", filepath.Dir(filepath.Dir(binding.NodePath)),
		)
	}
	command := exec.CommandContext(deadline, binding.NodePath, arguments...)
	command.Dir = "/"
	command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C"}
	command.ExtraFiles = []*os.File{child}
	command.Stdin = nil
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout := boundedBuffer{limit: maxControlOutputBytes}
	stderr := boundedBuffer{limit: maxControlOutputBytes}
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil || stdout.exceeded || stderr.exceeded {
		return nil, errors.New("the pinned automation control process rejected the request")
	}
	return stdout.Bytes(), nil
}

func verifyChannel(parsed arguments, binding launcherBinding) (map[string]any, error) {
	if parsed.controlPID != os.Getppid() {
		return nil, errors.New("the actor control process is not the verifier parent")
	}
	credentials, err := syscall.GetsockoptUcred(channelFD, syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	if err != nil || credentials.Pid <= 0 || int(credentials.Uid) != os.Getuid() {
		return nil, errors.New("the actor control channel peer identity is unavailable")
	}
	control, err := inspectProcess(parsed.controlPID)
	if err != nil {
		return nil, err
	}
	launcher, err := inspectProcess(int(credentials.Pid))
	if err != nil {
		return nil, err
	}
	if control.parentPID != launcher.pid || control.uid != os.Getuid() || launcher.uid != os.Getuid() ||
		control.path != binding.NodePath || launcher.path != binding.LauncherPath {
		return nil, errors.New("the actor control channel process chain does not match the binding")
	}
	controlBytes, _ := os.ReadFile(control.path)
	launcherBytes, _ := os.ReadFile(launcher.path)
	if digestBytes(controlBytes) != binding.NodeSHA256 || digestBytes(launcherBytes) != binding.LauncherSHA256 {
		return nil, errors.New("the actor control channel process binaries changed")
	}
	_ = syscall.SetsockoptTimeval(channelFD, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &syscall.Timeval{Sec: 5})
	channel := os.NewFile(uintptr(channelFD), "inherited-launcher-channel")
	challenge := make([]byte, channelChallengeSize)
	if _, err := io.ReadFull(channel, challenge); err != nil {
		return nil, errors.New("the actor control channel challenge is incomplete")
	}
	extra := make([]byte, 1)
	if count, err := channel.Read(extra); count != 0 || (err != nil && !errors.Is(err, io.EOF)) {
		return nil, errors.New("the actor control channel contained extra bytes")
	}
	actualChallenge := digestBytes(challenge)
	if actualChallenge != parsed.challengeSHA256 {
		return nil, errors.New("the actor control channel challenge does not match its digest")
	}
	runtimeDigest := runtimeDigest(binding)
	sessionMaterial := strings.Join([]string{
		channelProtocol, parsed.action, binding.Actor, binding.StateRoot,
		binding.LeaseName, parsed.operationID, parsed.tokenSHA256,
		strconv.Itoa(leaseLifetimeMS), launcher.startIdentity,
		control.startIdentity, binding.LauncherSHA256, runtimeDigest,
		actualChallenge, "",
	}, "\n")
	return map[string]any{
		"schemaVersion": 1, "protocol": channelProtocol,
		"action": parsed.action, "actor": binding.Actor,
		"stateRoot": binding.StateRoot, "leaseName": binding.LeaseName,
		"leaseOperationId": parsed.operationID, "tokenSha256": parsed.tokenSHA256,
		"ttlMs": leaseLifetimeMS, "launcherPid": launcher.pid,
		"launcherStartIdentity": launcher.startIdentity,
		"controlPid":            control.pid, "controlStartIdentity": control.startIdentity,
		"launcherSha256": binding.LauncherSHA256, "runtimeDigest": runtimeDigest,
		"challengeSha256":          actualChallenge,
		"sessionId":                digestBytes([]byte(sessionMaterial)),
		"launcherIdentityVerified": true, "runtimeIdentityVerified": true,
		"channelVerified": true,
	}, nil
}

func inspectProcess(pid int) (processIdentity, error) {
	var identity processIdentity
	statBytes, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return identity, errors.New("the process identity is unavailable")
	}
	statLine := string(statBytes)
	closing := strings.LastIndex(statLine, ")")
	if closing < 0 || closing+2 >= len(statLine) {
		return identity, errors.New("the process identity is invalid")
	}
	fields := strings.Fields(statLine[closing+2:])
	if len(fields) < 20 {
		return identity, errors.New("the process identity is incomplete")
	}
	parentPID, err := strconv.Atoi(fields[1])
	if err != nil || parentPID <= 0 || !isDecimal(fields[19]) {
		return identity, errors.New("the process start identity is invalid")
	}
	executable, err := filepath.EvalSymlinks(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil || !filepath.IsAbs(executable) {
		return identity, errors.New("the process executable identity is unavailable")
	}
	statusBytes, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return identity, errors.New("the process owner identity is unavailable")
	}
	uid := -1
	for _, line := range strings.Split(string(statusBytes), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				uid, _ = strconv.Atoi(parts[1])
			}
			break
		}
	}
	if uid < 0 {
		return identity, errors.New("the process owner identity is invalid")
	}
	return processIdentity{
		pid: pid, parentPID: parentPID, uid: uid, path: executable,
		startIdentity: fmt.Sprintf("%d:%s:0", pid, fields[19]),
	}, nil
}

func validateReadiness(value []byte, binding launcherBinding) error {
	var response struct {
		SchemaVersion      int    `json:"schemaVersion"`
		Protocol           string `json:"protocol"`
		Purpose            string `json:"purpose"`
		Actor              string `json:"actor"`
		StateRoot          string `json:"stateRoot"`
		LeaseName          string `json:"leaseName"`
		MaxLeaseLifetimeMS int    `json:"maxLeaseLifetimeMs"`
		Handoff            string `json:"handoff"`
		ChannelProtocol    string `json:"channelProtocol"`
		LauncherSHA256     string `json:"launcherSha256"`
		RuntimeDigest      string `json:"runtimeDigest"`
		CanonicalReady     bool   `json:"canonicalLeaseReady"`
		MutatesState       bool   `json:"mutatesState"`
	}
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&response) != nil || requireJSONEnd(decoder) != nil ||
		response.SchemaVersion != 1 || response.Protocol != attestationProtocol ||
		response.Purpose != attestationPurpose || response.Actor != binding.Actor ||
		response.StateRoot != binding.StateRoot || response.LeaseName != binding.LeaseName ||
		response.MaxLeaseLifetimeMS != leaseLifetimeMS || response.Handoff != bindingHandoff ||
		response.ChannelProtocol != channelProtocol || response.LauncherSHA256 != binding.LauncherSHA256 ||
		response.RuntimeDigest != runtimeDigest(binding) || !response.CanonicalReady || response.MutatesState {
		return errors.New("the readiness response does not match the trusted launcher channel")
	}
	return nil
}

func validateLeaseResponse(value []byte, binding launcherBinding, operation operationContext) (map[string]any, error) {
	var envelope acquireEnvelope
	previousPresent, shapeErr := acquireResultHasField(value, "previous")
	if shapeErr != nil || decodeStrict(value, &envelope) != nil || !envelope.OK || envelope.SchemaVersion != 1 ||
		envelope.Action != "lease.acquire" || envelope.StateRoot != binding.StateRoot ||
		!envelope.Result.Acquired || envelope.Result.Lease.Name != binding.LeaseName ||
		envelope.Result.Lease.Owner != binding.Actor || envelope.Result.Lease.Token != operation.token ||
		envelope.Result.Lease.SchemaVersion != 1 || envelope.Result.Lease.TTLMS != leaseLifetimeMS {
		return nil, errors.New("the pinned automation control response did not contain a bounded canonical lease")
	}
	authority, ok := actorAuthorities[binding.Actor]
	lease := envelope.Result.Lease
	recoveredValid := envelope.Result.Recovered == nil || *envelope.Result.Recovered
	if !ok || previousPresent != envelope.Result.Takeover || !recoveredValid ||
		lease.ObserverAuthority != authority.observer || lease.ProviderAuthority != authority.provider ||
		lease.CredentialKind != "trusted-launcher-channel" || lease.LauncherSHA256 != binding.LauncherSHA256 ||
		lease.ActorRuntimeDigest != runtimeDigest(binding) || lease.LauncherChannelProtocol != channelProtocol ||
		!isDigest(lease.LauncherAttestationSHA256) || !isDigest(lease.LauncherSessionID) ||
		len(lease.Token) < 32 || len(lease.Token) > 4*1024 || lease.HeartbeatAt != lease.AcquiredAt {
		return nil, errors.New("the pinned automation control response has invalid launcher provenance")
	}
	acquired, acquiredErr := time.Parse(time.RFC3339Nano, lease.AcquiredAt)
	expires, expiresErr := time.Parse(time.RFC3339Nano, lease.ExpiresAt)
	if acquiredErr != nil || expiresErr != nil || !expires.After(acquired) || expires.Sub(acquired) > 30*time.Minute {
		return nil, errors.New("the pinned automation control lease lifetime is invalid")
	}
	return map[string]any{
		"schemaVersion": 1, "actor": binding.Actor, "leaseName": binding.LeaseName,
		"leaseOperationId": operation.id, "leaseToken": operation.token,
		"leaseTokenSha256": operation.tokenSHA256,
		"acquiredAt":       lease.AcquiredAt,
		"expiresAt":        lease.ExpiresAt, "ttlMs": leaseLifetimeMS,
	}, nil
}

func releaseAfterAmbiguousAcquire(binding launcherBinding, operation operationContext) error {
	releaseID, err := newUUID()
	if err != nil {
		return err
	}
	for attempt := 0; attempt < 2; attempt++ {
		command := exec.Command(binding.NodePath, binding.ControlEntryPath,
			"lease", "release", "--state-root", binding.StateRoot,
			"--name", binding.LeaseName)
		command.Dir = "/"
		command.Env = []string{
			"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C",
			"FREED_AUTOMATION_LEASE_OPERATION_ID=" + releaseID,
			"FREED_AUTOMATION_LEASE_TOKEN=" + operation.token,
		}
		output := boundedBuffer{limit: maxControlOutputBytes}
		command.Stdout = &output
		command.Stderr = &output
		if command.Run() == nil && !output.exceeded {
			var envelope releaseEnvelope
			if decodeStrict(output.Bytes(), &envelope) == nil {
				leaseName, leaseOwner, leaseErr := publicLeaseIdentity(envelope.Result.Lease)
				if envelope.OK &&
					envelope.SchemaVersion == 1 && envelope.Action == "lease.release" &&
					envelope.StateRoot == binding.StateRoot && envelope.Result.Released &&
					leaseErr == nil && leaseName == binding.LeaseName && leaseOwner == binding.Actor {
					break
				}
			}
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		command := exec.Command(binding.NodePath, binding.ControlEntryPath,
			"lease", "show", "--state-root", binding.StateRoot,
			"--name", binding.LeaseName)
		command.Dir = "/"
		command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C"}
		output := boundedBuffer{limit: maxControlOutputBytes}
		command.Stdout = &output
		command.Stderr = &output
		if command.Run() == nil && !output.exceeded {
			var envelope showEnvelope
			if decodeStrict(output.Bytes(), &envelope) == nil && envelope.OK &&
				envelope.SchemaVersion == 1 && envelope.Action == "lease.show" &&
				envelope.StateRoot == binding.StateRoot && string(bytes.TrimSpace(envelope.Result)) == "null" {
				return nil
			}
		}
	}
	return errors.New("a failed acquisition may have left an unknown actor lease live")
}

func newOperation() (operationContext, error) {
	id, err := newUUID()
	if err != nil {
		return operationContext{}, errors.New("the lease operation identity could not be generated")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return operationContext{}, errors.New("the caller-retained lease token could not be generated")
	}
	token := base64.StdEncoding.EncodeToString(secret)
	for index := range secret {
		secret[index] = 0
	}
	return operationContext{id: id, token: token, tokenSHA256: digestBytes([]byte(token))}, nil
}

func newUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

func channelChallenge(operation operationContext) []byte {
	value := sha256.Sum256([]byte("freed-actor-channel-challenge-v1\n" + operation.id + "\n" + operation.tokenSHA256 + "\n"))
	return value[:]
}

func runtimeDigest(binding launcherBinding) string {
	value := strings.Join([]string{
		runtimeProtocol,
		"node:" + binding.NodeSHA256,
		"automation-control.mjs:" + binding.ControlEntrySHA256,
		"automation-actor-control.mjs:" + binding.ActorControlEntrySHA256,
		"lib/automation-control.mjs:" + binding.ControlLibrarySHA256,
		"lib/automation-actor-readiness.mjs:" + binding.ReadinessLibrarySHA256,
		"lib/automation-kernel-guard-contract.mjs:" + binding.KernelGuardContractSHA256,
		"lib/outcome-ledger-repair-contract.mjs:" + binding.OutcomeLedgerRepairContractSHA256,
		"lib/lease-archive-move.py:" + binding.LeaseArchiveHelperSHA256,
		"",
	}, "\n")
	return digestBytes([]byte(value))
}

func readProtectedFile(file, root string, requiredUID int, executable bool, maxBytes int64) ([]byte, error) {
	if !filepath.IsAbs(file) || filepath.Clean(file) != file || !filepath.IsAbs(root) {
		return nil, errors.New("path is not canonical and absolute")
	}
	realFile, err := filepath.EvalSymlinks(file)
	if err != nil || realFile != file {
		return nil, errors.New("path contains a symbolic link")
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil || realRoot != root || !strictChild(root, file) {
		return nil, errors.New("path escapes its trusted root")
	}
	for current := "/"; ; {
		if current != "/" {
			info, err := os.Lstat(current)
			if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
				!trustedOwner(ownerUID(info), requiredUID) || info.Mode().Perm()&0o022 != 0 {
				return nil, errors.New("path contains an untrusted directory")
			}
		}
		if current == filepath.Dir(file) {
			break
		}
		relative, relativeErr := filepath.Rel(current, filepath.Dir(file))
		if relativeErr != nil || relative == "." || strings.HasPrefix(relative, "..") {
			return nil, errors.New("path hierarchy is invalid")
		}
		current = filepath.Join(current, strings.Split(relative, string(filepath.Separator))[0])
	}
	for current := filepath.Dir(file); ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !trustedOwner(ownerUID(info), requiredUID) || info.Mode().Perm()&0o022 != 0 {
			return nil, errors.New("path contains an untrusted directory")
		}
		if current == root {
			break
		}
		if current == filepath.Dir(current) {
			return nil, errors.New("path does not reach its trusted root")
		}
	}
	descriptor, err := syscall.Open(file, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errors.New("protected file cannot be opened")
	}
	handle := os.NewFile(uintptr(descriptor), file)
	defer handle.Close()
	info, err := handle.Stat()
	if err != nil || !info.Mode().IsRegular() || !trustedOwner(ownerUID(info), requiredUID) ||
		info.Mode().Perm()&0o022 != 0 || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 ||
		info.Size() < 1 || info.Size() > maxBytes {
		return nil, errors.New("file type, owner, mode, or size is unsafe")
	}
	if executable && info.Mode().Perm()&0o100 == 0 {
		return nil, errors.New("trusted executable is not owner-executable")
	}
	value, err := io.ReadAll(io.LimitReader(handle, maxBytes+1))
	if err != nil || int64(len(value)) != info.Size() || int64(len(value)) > maxBytes {
		return nil, errors.New("protected file changed while being read")
	}
	return value, nil
}

func trustedOwner(actual, required int) bool {
	return actual == required || (testingMode == "true" && actual == os.Getuid())
}

func requirePhysicalPrivateDirectory(directory string, owner int) error {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return errors.New("directory is not canonical and absolute")
	}
	real, err := filepath.EvalSymlinks(directory)
	info, statErr := os.Lstat(directory)
	if err != nil || statErr != nil || real != directory || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || ownerUID(info) != owner || info.Mode().Perm()&0o077 != 0 {
		return errors.New("directory is not a private physical owner directory")
	}
	return nil
}

func ownerUID(info os.FileInfo) int {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return int(stat.Uid)
	}
	return -1
}

func strictChild(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func digestBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func isDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' || value[14] != '4' {
		return false
	}
	_, err := hex.DecodeString(strings.ReplaceAll(value, "-", ""))
	return err == nil && value == strings.ToLower(value) && strings.Contains("89ab", value[19:20])
}

func isDecimal(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return value != "0"
}

func requireJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("JSON document contains trailing data")
	}
	return nil
}

func decodeStrict(value []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	return requireJSONEnd(decoder)
}

func acquireResultHasField(value []byte, field string) (bool, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(value, &envelope); err != nil {
		return false, err
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(envelope["result"], &result); err != nil {
		return false, err
	}
	_, present := result[field]
	return present, nil
}

func publicLeaseIdentity(value []byte) (string, string, error) {
	var lease map[string]any
	if err := json.Unmarshal(value, &lease); err != nil {
		return "", "", err
	}
	name, nameOK := lease["name"].(string)
	owner, ownerOK := lease["owner"].(string)
	if !nameOK || !ownerOK {
		return "", "", errors.New("the public lease identity is invalid")
	}
	return name, owner, nil
}
