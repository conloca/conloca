# Managed by `smoo monorepo`. Repo-owned configuration belongs in devenv.nix,
# which imports this module:
#
#   imports = [./devenv.smoo.nix];
#
# This is the SmoothBricks shell contract — the wiring that pairs with the other
# managed files (tooling/direnv/repo-path, setup-environment.ts, the CI actions)
# and must stay identical across repositories. `enterShell` is `types.lines`, so
# this module's prologue and epilogue merge around whatever devenv.nix adds:
# mkBefore establishes the workspace root, PATH, and toolchain before any
# project step runs, and mkAfter restores the caller's directory last.
#
# Every explanation lives out here in Nix comments. Hook bodies are exported as
# shell text, so a comment inside one becomes part of an environment variable.
{
  inputs,
  lib,
  pkgs,
  ...
}: let
  # ttsc's native-plugin patch compiles microsoft/typescript-go with one
  # corrected file. `go list -m` only fills `.Dir` after the module is already
  # in GOMODCACHE, which CI does not restore (and GOPROXY is often off under
  # nix). Pin the commit ttsc 0.30.4's patch requires so the tree is in the
  # devenv closure and TTSC_TYPESCRIPT_GO_DIR names it.
  typescriptGo = pkgs.fetchFromGitHub {
    owner = "microsoft";
    repo = "typescript-go";
    rev = "56ab4af42157";
    hash = "sha256-ebjX+1+9axEqsnZXCRZSumA38gPNdmoz98tMt2oftN4=";
  };
in {
  env = lib.mkMerge [
    {
      # Nx otherwise defaults to three workers. Scale to the cores available in each
      # developer shell or CI runner; explicit --parallel flags still take precedence.
      NX_PARALLEL = "100%";
      TTSC_TYPESCRIPT_GO_DIR = "${typescriptGo}";
    }
    # Playwright's downloaded Ubuntu browser has no runtime closure on NixOS
    # (CI reached the executable, then failed loading libglib-2.0.so.0). Use
    # the lock-pinned Nix browser and its libraries; smoo passes this executable
    # to the child before Playwright imports. Darwin keeps its native browser path.
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = lib.getExe pkgs.chromium;
    })
  ];
  # sccache is deliberately absent from this shell. It used to export
  # RUSTC_WRAPPER=sccache as a BARE NAME, which PATH then resolved per project —
  # which is precisely how an unpatched binary from one profile came to serve
  # clients from another. sccache now belongs to cowshed: `cowshed setup
  # --sccache` builds packages/cowshed/nix/sccache, pins the result with a nix GC
  # root, and supervises that exact store path. A repository shell has no
  # business deciding which compiler cache a host runs.

  # One toolchain for every repository and every workspace, pinned by devenv.lock
  # rather than by a rust-toolchain file. devenv resolves the channel through
  # rust-overlay, so a lock bump is the only thing that moves the compiler, and a
  # CI runner building this same shell gets the same rustc a laptop has.
  #
  # Nightly because the fleet needs `-Z` features (`-Zbuild-std`,
  # `panic=immediate-abort` for wasm artifacts) and there is no reason to keep a
  # second toolchain alongside for them. `version = "latest"` reads "newest
  # nightly the locked rust-overlay offers", not "whatever nightly exists today".
  #
  # `components` and fleet-wide `targets` belong to this module; repositories
  # add only platform- or product-specific targets in devenv.nix. These list
  # options merge, while `channel` and `version` are single-valued. A
  # `rust-toolchain.toml` is NOT the
  # mechanism here: nix cargo ignores it unless devenv is pointed at it with
  # `languages.rust.toolchainFile`, so such a file is decoration that silently
  # disagrees with the shell.
  languages.rust = {
    enable = true;
    channel = "nightly";
    version = "latest";
    components = [
      "rustc"
      "cargo"
      "clippy"
      "rustfmt"
      "rust-analyzer"
      "rust-src"
    ];
    # Every repository builds WASM, so the shared shell always carries that std.
    # Keeping it here prevents each repo from restating the same target.
    # CI validates on Linux, so a macOS shell carries Linux's std and can
    # type-check the arm CI compiles. rust-std alone reaches every crate whose
    # dependency graph is pure Rust; a dependency that compiles C for the target
    # — ring, openssl-sys, libgit2-sys, libz-sys — additionally needs a cross C
    # compiler, which is 0.4 GiB and so lives in the opt-in `linux-cross` profile
    # below rather than here, keeping it off every macOS shell and macOS runner.
    #
    # The reverse direction is not available at any price: type-checking an Apple
    # target from Linux needs an Apple SDK for those same C-building
    # dependencies, which is a licensing boundary rather than a missing package.
    targets = [
      "wasm32-unknown-unknown"
      "x86_64-unknown-linux-gnu"
    ];
  };

  # Opt-in Linux cross toolchain, activated by `devenv -P linux-cross` and driven
  # by the root `check:linux` script. devenv 2.2.3 has first-class profiles, so
  # this is one gated module in the shared file rather than a second config
  # directory that would have to re-import and re-pin everything here.
  #
  # It is a profile and NOT a default package because pkgsCross.gnu64's cc
  # closure is 0.4 GiB against a default shell closure of ~5.4 GiB — a 7% tax on
  # every shell entry and every CI cache restore, to serve one command that a
  # macOS laptop runs deliberately. Nothing on Darwin links a Linux object.
  #
  # Why a C compiler is needed at all, when rust-std above is already installed:
  # ring, openssl-sys, libgit2-sys and libz-sys compile C for the target from
  # their build scripts, and build scripts are compiled and run even under
  # `cargo check`, so std alone stops at `ToolNotFound: failed to find tool
  # "x86_64-linux-gnu-gcc"`. The `cc` crate probes triple-prefixed tool names,
  # which is precisely what this wrapper's bin/ exports.
  #
  # Each tool path is derived from the wrapper's own `targetPrefix` instead of
  # being written out, so a nixpkgs bump that renames the prefix carries these
  # with it rather than leaving four stale strings that fail at build-script time.
  #
  # This profile supplies the toolchain and nothing else. CARGO_BUILD_TARGET is
  # deliberately NOT set: the triple belongs to the Nx target that asks for it
  # (`cargo-lint-x64-linux` passes `--target` explicitly), not to the ambient
  # environment. An ambient triple would make the check silently host-local
  # whenever the profile was forgotten — reporting green having compiled macOS —
  # and that false green is the precise failure this whole profile exists to end.
  # With the flag on the target instead, running it outside this profile fails
  # loudly at `ToolNotFound` and a host lint can never be mistaken for a cross one.
  profiles.linux-cross.module = let
    crossCC = pkgs.pkgsCross.gnu64.stdenv.cc;
    crossLibc = lib.getDev crossCC.libc;
    tool = name: "${crossCC}/bin/${crossCC.targetPrefix}${name}";
  in {
    packages = [crossCC];
    env = {
      CC_x86_64_unknown_linux_gnu = tool "cc";
      CXX_x86_64_unknown_linux_gnu = tool "c++";
      AR_x86_64_unknown_linux_gnu = tool "ar";
      CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER = tool "cc";
      # bindgen runs host libclang, which cannot infer the cross compiler's headers.
      BINDGEN_EXTRA_CLANG_ARGS_x86_64_unknown_linux_gnu = "--target=x86_64-unknown-linux-gnu -isystem ${crossLibc}/include -isystem ${pkgs.pkgsCross.gnu64.linuxHeaders}/include";
    };
  };

  # linux-cross is the only profile here, and the shape of the publish job is
  # why. A lean publish shell was measured and rejected, so the next reader does
  # not have to measure it again.
  #
  # The ceiling first: dropping rustc, Go, binaryen, the cargo helpers, python
  # and the clang/lldb tools leaves 2.21 GiB of a 5.41 GiB default closure
  # (`nix path-info -S` over the devenv profile, aarch64-darwin), and modules
  # only ADD — so collecting that saving means moving the toolchain OUT of base
  # and making every developer shell and every other CI job pass `-P`. A
  # forgotten flag then yields a shell that is quietly missing a compiler, which
  # is the same false green the paragraph above exists to prevent.
  #
  # Repair is what makes it unfixable rather than merely awkward. `smoo release
  # repair-pending` builds the historical release commits npm is missing, and it
  # gets their toolchain by running a plain `devenv shell` AT that checkout
  # (packages/cli/src/lib/devenv.ts). No flag is passed and none can be: devenv
  # throws for a profile the checked-out commit does not define — `Profile 'x'
  # not found. Available profiles: ...` — which is every release commit older
  # than the split. Leave the flag off and a post-split commit hands repair a
  # base without rustc; add it and every pre-split commit fails to evaluate.
  # Either way the break surfaces months later, in the one command whose whole
  # job is to recover a release that already went wrong.
  #
  # The publish job's OWN environment is not just publishing either: `smoo
  # release publish --prebuilt` runs each project's Nx `release-check` gate over
  # the merged artifacts, which is where a native or wasm artifact is validated
  # before it is packed. A lean publish shell removes those tools silently, from
  # the one step that exists to refuse a bad artifact.
  #
  # And it would not even pay: the Actions nix segment is keyed on
  # os+arch+hash(devenv.yaml, devenv.nix, devenv.lock) and is blind to the
  # profile, so a restore ships the whole NAR regardless, while the save exports
  # the closure that job realized. A lean publish job that won that immutable
  # key would hand the CI workflow a NAR with no toolchain in it. On any run
  # where repair has work the saving is zero anyway, because repair realizes the
  # historical default shell inside the same job.

  # One Go for every repository, same reasoning as the Rust toolchain: a compiler
  # is part of a cache key, so two of them mean two caches.
  #
  # Pinned to the patch release ttsc vendors inside its native package, because
  # that SDK is not overridable — ttsc exposes cache locations and
  # TTSC_TSGO_BINARY, never the Go it builds plugins with — so matching it is the
  # only way to have ONE Go rather than ours plus a dependency's. `smoo monorepo
  # check` enforces the match and fails with both versions when they diverge,
  # which is what makes this pin a maintained invariant instead of a comment that
  # rots.
  #
  # It needs its own input because the fleet's nixpkgs does not carry that patch:
  # devenv-nixpkgs rolling ships go 1.26.5 and its `go_1_27` is a release
  # candidate, while ttsc 0.28.3 vendors go1.26.7. Same idiom, and same reason,
  # for any single-package pin — one leaf package from a nixpkgs that has it,
  # lock-pinned, prebuilt, rather than a fleet-wide bump that would move rustc,
  # bun and node too. Not every pairing is reachable: ttsc 0.28.1/0.28.2 vendor
  # go1.26.6, which NO channel packages, so when no revision offers the vendored
  # patch the ttsc pin is what moves.
  #
  # The ownership boundary this pin sits inside, unchanged by it: our code is
  # built with the Go devenv provides, a dependency may vendor its own SDK, and
  # neither may leak GOROOT into the other. Go therefore arrives via `packages`
  # and NOT `languages.go.enable`, which would export GOROOT; on PATH only, each
  # toolchain resolves its own GOROOT from its own binary. With the versions
  # matched that crossing cannot misfire at all, so the unset in enterShell is
  # belt-and-braces rather than the fix.
  # Node tracks the newest AWS Lambda managed runtime, currently nodejs26.x. It
  # lives here rather than in each repository's devenv.nix because it is a
  # fleet-wide fact: declared in three places, the next bump has to find all
  # three, and the one it misses re-splits the fleet.
  #
  # An explicit major, NOT `nodejs_latest`. A tool that participates in cache keys
  # and native-addon ABI must not be spelled "whatever is newest" in one
  # repository and a fixed major in the others — and the two spellings agreeing
  # today is precisely what makes the drift invisible, because the fleet looks
  # unified right up to the lock bump that splits it. A floating attribute is a
  # version that changes without a commit, so it cannot be reviewed or bisected.
  #
  # 26 also closes a split this axis caused once: 24.0.x declares URLPattern in a
  # way that TS2403-conflicts with lib.dom in consumers emitting declarations,
  # which forced a ~24.13.0 floor on one side; 26 is DOM-compatible.
  #
  # `@types/node`, `engines.node` and `packageManager` are derived from this pin
  # rather than maintained beside it — smoo's syncRootRuntimeVersions reads the
  # shell's Node major, so this line moves them.
  #
  # Reading which version this resolves to: devenv.lock has TWO nixpkgs nodes and
  # the obvious one is a decoy. `.nodes.nixpkgs` is not what `pkgs` is; the
  # authoritative path is `.nodes.root.inputs.nixpkgs`, which indirects to
  # `nixpkgs_2`.
  packages =
    [
      (import inputs.nixpkgs-go {inherit (pkgs.stdenv.hostPlatform) system;}).go
      pkgs.nodejs_26
      pkgs.binaryen
      # Test runner for inferred Cargo test targets. Generated targets must never
      # depend on an ambient host installation that CI does not reproduce.
      pkgs.cargo-nextest
      # Target-dir GC for the inferred cargo-sweep target: cargo never removes
      # superseded artifacts on its own (a busy workspace accumulated ~18k stale
      # variants per crate and 26 GB of junk before this existed), and a sweep
      # prunes them without touching the warm current-fingerprint surface.
      pkgs.cargo-sweep
      # The stable-toolchain arm of smoo's workspace feature-unification policy:
      # `cargo hakari` generates and wires the workspace-hack crate that unifies
      # features when `[resolver] feature-unification` — nightly-only, and what
      # the channel above selects — is unavailable. `smoo monorepo validate` runs
      # `cargo hakari verify` for a workspace that took that route.
      pkgs.cargo-hakari
    ]
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux [pkgs.chromium];

  enterShell = lib.mkMerge [
    # Prologue, in order:
    #
    # 1. The devenv wrapper runs from tooling/direnv; every later step expects the
    #    workspace root.
    # 2. PATH order is most-specific → least-specific, the same list the git hooks
    #    use, so a hook and a shell resolve one binary the same way.
    # 3. ttsc drives the native TypeScript 7 binary while Nx imports the TypeScript
    #    6 API, so the two must be named separately.
    # 4. On a cowshed host, Go and ttsc caches point at the shared store, so every
    #    workspace reads one warm cache instead of growing its own copy inside its
    #    image. Without one, ttsc stays in-tree for the CI cache action while Go
    #    keeps its normal per-user defaults. Both Go caches are content-addressed,
    #    so sharing them needs no patch — unlike Rust, Go keys on content and flags
    #    rather than on where the files live. An inherited value always wins so CI
    #    can place any of these caches itself. GOFLAGS carries -trimpath because it
    #    is Go's stable way to keep absolute build paths out of the artifact, and
    #    unlike Rust's trim-paths it costs no cache reuse.
    #
    #    ttsc's plugin builds use the Go it bundles rather than ours, so the
    #    repository's own Go work and ttsc's plugin builds are two toolchains by
    #    construction. Placing both caches in the shared store is what keeps that
    #    from costing a rebuild per workspace.
    #
    #    TTSC_GO_CACHE_DIR and GOCACHE stay separate for ownership, not
    #    correctness: both caches are content-addressed, so one directory would
    #    compile the same bytes to the same entries. What sharing loses is an
    #    owner. ttsc reclaims a Go build cache only when it resolved that
    #    directory itself — `ttsc clean` takes the cache whose source is
    #    TTSC_GO_CACHE_DIR and never one whose source is a user GOCACHE, which it
    #    treats as someone else's property. Pointing ttsc at GOCACHE therefore
    #    produced a directory ttsc filled and no repository verb could empty,
    #    measured at 35G here. A dedicated directory gives ttsc's half back to
    #    `ttsc clean` and leaves GOCACHE holding only Go work this repository does
    #    itself, which is one module.
    #
    #    That buys ownership, not automatic GC: ttsc prunes opportunistically only
    #    when it owns the whole cache root, which requires TTSC_CACHE_DIR unset,
    #    and a pinned shared root is the point of the block below. The trade is
    #    deliberate — one warm cache every workspace shares, reclaimed by an
    #    explicit verb, over per-workspace caches that self-trim. Go's own build
    #    cache trimming belongs to the go command and still applies to both.
    # 5. The shared setup-environment.ts bootstraps repository dependencies; a
    #    failure aborts shell entry instead of yielding a half-working shell.
    #    Repo-owned enterShell bodies merge after this prologue.
    # 6. Shell entry resolves the `shell` group of `smoo.secrets` and nothing
    #    else. Shell entry happens on every direnv reload and every
    #    `devenv shell -- <command>`, and a provider command that runs then is a
    #    credential prompt on every one of them (1Password authorises per
    #    requesting process lineage, and this one is new each time). A
    #    credential only one deliberate command needs belongs to that command:
    #    `smoo secrets run <group> <command...>`. The full statement, and the
    #    derivation below, live in tooling/direnv/secret-references.ts.
    #
    #    A group is derived from what the repository already declares, so
    #    nothing restates it:
    #
    #    The variable `smoo.remoteCache.tokenSecret` names is group
    #    `nx-cache`, and shell entry never resolves it. Nx reads
    #    NX_SELF_HOSTED_REMOTE_CACHE_SERVER and _ACCESS_TOKEN from the
    #    environment when it runs: CI injects them into the job, a developer
    #    exports the token once in the terminal that wants the cache (for
    #    example `op signin`, then the declared command), and every nested
    #    shell inherits it. Absent, Nx runs with the local cache only.
    #
    #    A variable `.npmrc` interpolates as `${VAR}` is group `registry`,
    #    deferred rather than resolved, so setup-environment.ts installs
    #    without it. An installed checkout contacts no registry, which is why
    #    that costs nothing in the common case; an install that genuinely
    #    needs one fails naming the variable, and `smoo secrets run registry
    #    bun install` supplies it for that one command.
    # 7. GOROOT is unset rather than set. With devenv's Go pinned to the patch
    #    release ttsc vendors, a GOROOT crossing cannot misfire on version at all,
    #    so this is belt-and-braces rather than the fix — it keeps the isolation
    #    boundary intact even while the two are momentarily out of step, e.g. after
    #    a ttsc bump and before the Go pin follows it. The boundary itself: our Go
    #    comes from devenv, a dependency may vendor its own SDK, and neither may
    #    leak GOROOT into the other. An inherited GOROOT names exactly one
    #    toolchain and so is wrong for at least one side, surfacing as `compile:
    #    version does not match go tool version`. Absent the variable, every Go
    #    resolves its own GOROOT from its own binary, which makes "whose Go is
    #    whose" a property of which binary is invoked — the only thing that can
    #    actually be reasoned about.
    # 8. On Darwin, drop nix CC/CXX so xcodebuild finds Xcode's clang (it supports
    #    -index-store-path); bun/node native addons find compilers through
    #    node-gyp. CC/CXX are what xcodebuild reads, which is why they go rather
    #    than being pointed somewhere else.
    #
    #    The Apple SDK is the same boundary, and dropping CC/CXX alone does not
    #    hold it. An outer nix stdenv exports SDKROOT and DEVELOPER_DIR pointing
    #    at nixpkgs' RECONSTRUCTED apple-sdk, so Xcode's own clang goes on to
    #    compile against that sysroot. It is not a substitute for the licensed
    #    SDK: apple-sdk-14.4 carries usr/include and the frameworks but NO libc++
    #    whatsoever — no usr/include/c++/v1 and no usr/lib/libc++* — so any C++
    #    build script that resolves the SDK by name dies at `ld: library 'c++'
    #    not found`, which a CMake `*-sys` crate reaches before compiling a line
    #    of the project. DEVELOPER_DIR is the half that hides: `xcrun
    #    --show-sdk-path` honours it, so even code that correctly asks xcrun for
    #    the SDK is handed the nix one, while `xcrun --find clang` and
    #    `xcodebuild -version` keep reporting Xcode and look healthy. It also
    #    defeats any later guard that unsets a nix SDKROOT and then re-resolves
    #    it through xcrun, because xcrun answers with the same tree again.
    #
    #    Only a /nix/store value is dropped. An SDKROOT the operator exported
    #    deliberately — the documented way to link Darwin from a Linux host — is
    #    left exactly as given. Each drop is announced, so a shell never silently
    #    swaps the SDK a build was compiled against.
    # Nx's fallback includes HOME or TMPDIR, either of which can exceed the
    # Unix socket limit in a checkout. Reuse devenv's short runtime directory,
    # which is keyed on this checkout's devenv root and so is one per
    # workspace. Unconditionally: an inherited value is another workspace's
    # shell (a shed entered from the host, a second repository from the first,
    # a subprocess of either), and one socket dir for two workspaces makes the
    # daemon refuse whichever came second ("received a message from a
    # different workspace"). Nobody supplies this deliberately.
    (lib.mkBefore ''
      cd "$DEVENV_ROOT/../.."
      export PATH="$("$PWD/tooling/direnv/repo-path")"
      # devenv enters the shell with TMPDIR unset (not empty) on every platform.
      # Tools then fall back to /tmp, which on Darwin is not the per-user
      # temporary directory the OS hands out, and a test that asserts the
      # parent carries TMPDIR (so its env_clear check means something) fails in
      # the shell and passes outside it. Ask the OS; an explicit value wins.
      if [ -z "''${TMPDIR:-}" ]; then
        TMPDIR="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true)"
        export TMPDIR="''${TMPDIR:-/tmp}"
      fi
      export TTSC_TSGO_BINARY="$PWD/node_modules/@typescript/native/bin/tsc"
      if [ -d "$HOME/.cowshed/caches" ]; then
        export TTSC_CACHE_DIR="''${TTSC_CACHE_DIR:-$HOME/.cowshed/caches/ttsc}"
        export GOCACHE="''${GOCACHE:-$HOME/.cowshed/caches/go/build}"
        export GOMODCACHE="''${GOMODCACHE:-$HOME/.cowshed/caches/go/mod}"
        mkdir -p "$GOCACHE" "$GOMODCACHE"
      else
        export TTSC_CACHE_DIR="''${TTSC_CACHE_DIR:-$PWD/.cache/ttsc}"
      fi
      export TTSC_GO_CACHE_DIR="''${TTSC_GO_CACHE_DIR:-$TTSC_CACHE_DIR/go-build}"
      mkdir -p "$TTSC_CACHE_DIR" "$TTSC_GO_CACHE_DIR"
      export GOFLAGS="''${GOFLAGS:--trimpath}"
      unset GOROOT
      bun "$DEVENV_ROOT/setup-environment.ts" || exit $?
      # One socket dir per Nx workspace. DEVENV_RUNTIME is keyed to the devenv
      # ROOT, so every workspace sharing one devenv - a sibling repository, a
      # copy-on-write clone, a scratch workspace created inside this shell -
      # would land on one socket. The first daemon to claim it then refuses
      # every message from the others ("received a message from a different
      # workspace"), which reads as a hung Nx in a workspace that did nothing
      # wrong. Nx's own diagnostic names this exact cause.
      nx_workspace_root="$(cd "$DEVENV_ROOT/../.." >/dev/null 2>&1 && pwd || printf '%s' "$PWD")"
      export NX_SOCKET_DIR="$DEVENV_RUNTIME/nx-$(printf '%s' "$nx_workspace_root" | cksum | cut -d' ' -f1)"
      mkdir -p "$NX_SOCKET_DIR"
      ${lib.optionalString pkgs.stdenv.isDarwin ''
        unset CC CXX
        case "''${SDKROOT:-}" in
          /nix/store/*)
            echo "devenv: dropping nix-store SDKROOT ($SDKROOT); Xcode holds the licensed macOS SDK" >&2
            unset SDKROOT NIX_APPLE_SDK_VERSION
            ;;
        esac
        case "''${DEVELOPER_DIR:-}" in
          /nix/store/*)
            echo "devenv: dropping nix-store DEVELOPER_DIR ($DEVELOPER_DIR); xcrun must answer from Xcode" >&2
            unset DEVELOPER_DIR NIX_APPLE_SDK_VERSION
            ;;
        esac
      ''}
    '')
    # Epilogue, after every project step (a project's own enterShell may resolve
    # SDKROOT/compilers; the toolchain identity must see the final values). The
    # stamp logic lives in toolchain-stamp.ts; see its header for why.
    (lib.mkAfter ''
      bun "$DEVENV_ROOT/toolchain-stamp.ts" || exit $?
      if [ -n "$DEVENV_SHELL_PWD" ]; then
        cd "$DEVENV_SHELL_PWD"
      fi
    '')
  ];
}
