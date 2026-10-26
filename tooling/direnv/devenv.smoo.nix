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
  config,
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

  # The nixpkgs the Go pin below comes from (devenv.yaml `nixpkgs-go`).
  goPkgs = import inputs.nixpkgs-go {inherit (pkgs.stdenv.hostPlatform) system;};

  # The native TypeScript compiler typecheck targets run, built from a pinned
  # source revision rather than taken from the npm `@typescript/native` binary
  # that emit, editors and ttsc plugins keep using. The Nx plugin's inferred
  # `typecheck` and `typecheck-tests` run it directly (not through ttsc, whose
  # auto-loaded typia host checks with its own compiler) and hash this path as
  # an input, so a revision bump is a cache miss.
  #
  # The revision is can1357/TypeScript perf/checker-speedups-v3: 36 checker,
  # arena and scheduler commits on microsoft/TypeScript main 6ad8c56f9b5a,
  # while they are upstreamed. Its Go module (tsc/, Go 1.27) builds with the
  # nixpkgs-go input's go_1_27 inside this derivation; the shell's own Go stays the
  # one ttsc vendors. The sparse checkout keeps the ~61k test baselines out of
  # the store, and GOWORK=off keeps the repository's go.work (tools/) out of
  # the module build.
  typecheckTsc = goPkgs.buildGo127Module {
    pname = "tsc";
    version = "7.1.0-dev-c1ae0cde";
    src = pkgs.fetchFromGitHub {
      owner = "can1357";
      repo = "TypeScript";
      rev = "c1ae0cde041b8aa08600198fad014d869c83b602";
      sparseCheckout = ["tsc/cmd" "tsc/internal"];
      hash = "sha256-X4wKd/+b4EGMGwXGpfQ5YHkgfqqtPgfyf3x1maEuE+4=";
    };
    modRoot = "tsc";
    subPackages = ["cmd/tsc"];
    vendorHash = "sha256-XmN6VfL922FqKUHRnBfGTuEUFbPELf8F6JINVMTz1/w=";
    env = {
      CGO_ENABLED = "0";
      GOWORK = "off";
    };
    ldflags = ["-s" "-w"];
    # Upstream's tests run against the full checkout's baselines, which the
    # sparse source omits; the revision is the tested artifact.
    doCheck = false;
  };

  # A repository that enables uv under languages.python gets its uv workspace
  # synced and activated by this contract (enterShell item 5), never by
  # devenv's own python tasks.
  python = config.languages.python;
  uvProject = python.enable && python.uv.enable;

  # The Rust toolchain's own store bin, put ahead of this checkout's profile on
  # PATH (enterShell item 2). `cargo clippy` runs `cargo-clippy`, which sets
  # RUSTC_WORKSPACE_WRAPPER to the clippy-driver beside its own executable path
  # (current_exe, which on Darwin is the path that was executed, symlinks
  # unresolved), and cargo hashes that wrapper path into the identity of every
  # workspace unit it checks. Reached through
  # `<checkout>/tooling/direnv/.devenv/profile/bin`, the wrapper names the
  # checkout, so a copy-on-write clone at another path re-checks every
  # workspace crate under fresh unit directories although its target/ arrived
  # warm, and the stale ones pile up per checkout. Resolved here, cargo,
  # cargo-clippy and clippy-driver are one store path in every checkout.
  # rustc resolves here too, but cargo keys units on its `-vV` output and not
  # its path, so plain builds keep their units. The profile still carries the
  # same files for anything that names it.
  rustToolchainBin = "${config.languages.rust.toolchainPackage}/bin";

  # Expose pyflakes without propagating a second interpreter into the shell.
  pyflakesBin = pkgs.runCommandLocal "pyflakes-${pkgs.python3Packages.pyflakes.version}" {} ''
    mkdir -p "$out/bin"
    ln -s ${pkgs.python3Packages.pyflakes}/bin/pyflakes "$out/bin/pyflakes"
  '';

  # Builds every Linux artifact and the cross clippy; see `profiles.linux-cross`
  # below for where it applies and why. The rust-std set is every Linux triple
  # an artifact ships for except x86_64-unknown-linux-gnu, which the base shell
  # already carries.
  linuxToolchain = {
    packages = [pkgs.zig pkgs.cargo-zigbuild];
    languages.rust.targets = [
      "aarch64-unknown-linux-gnu"
      "x86_64-unknown-linux-musl"
      "aarch64-unknown-linux-musl"
    ];
  };
in {
  # nixpkgs carries actionlint, not the jdx fork. Supply the immutable upstream
  # release as a normal package, with the same pin in developer shells and CI.
  # Nix fetches/verifies it once; validation never installs or compiles a tool.
  overlays = [
    (_final: prev: let
      sources = {
        aarch64-darwin = {
          platform = "darwin_arm64";
          hash = "sha256-GtIQvSH0xwqB4L/+zG0iPayo3RPlf6aJl4cGT4tyTHw=";
        };
        x86_64-darwin = {
          platform = "darwin_amd64";
          hash = "sha256-A8y1LzvzxrG2NYaJpNMeXwXVWLMsC47a6sfEUqvn//Q=";
        };
        aarch64-linux = {
          platform = "linux_arm64";
          hash = "sha256-l4qfMsxO0dgblFY/xJZDuLOkjcuk0eoInZugX34X56c=";
        };
        x86_64-linux = {
          platform = "linux_amd64";
          hash = "sha256-AmvObQ7xlvWyK/Q6yxNI1HxdClrmHW7DvboSKagjFhs=";
        };
      };
      system = prev.stdenv.hostPlatform.system;
      source = sources.${system} or (throw "jactionlint: unsupported managed shell platform ${system}");
    in {
      jactionlint = prev.stdenvNoCC.mkDerivation rec {
        pname = "jactionlint";
        version = "2.0.2";
        src = prev.fetchurl {
          url = "https://github.com/jdx/jactionlint/releases/download/v${version}/jactionlint_${version}_${source.platform}.tar.gz";
          inherit (source) hash;
        };
        sourceRoot = ".";
        dontConfigure = true;
        dontBuild = true;
        # Preserve the upstream signed macOS executable; no strip/patch phase.
        dontFixup = true;
        installPhase = ''
          runHook preInstall
          install -Dm755 jactionlint "$out/bin/jactionlint"
          runHook postInstall
        '';
        meta = {
          description = "Static correctness, security and policy checker for GitHub Actions";
          homepage = "https://github.com/jdx/jactionlint";
          license = lib.licenses.mit;
          mainProgram = "jactionlint";
          platforms = builtins.attrNames sources;
        };
      };
    })
  ];

  env = lib.mkMerge [
    {
      # Nx otherwise defaults to three workers. Scale to the cores available in each
      # developer shell or CI runner; explicit --parallel flags still take precedence.
      NX_PARALLEL = "100%";
      # Every Nx daemon, when it starts, installs nx@latest from the registry
      # into a temporary directory to ask the newest release whether to prompt
      # for Nx Console and whether AI agent configuration is outdated, and
      # `nx configure-ai-agents` and `nx init` do the same. NX_USE_LOCAL answers
      # from the installed nx, so starting Nx installs nothing from the registry.
      # (A daemon still runs `git ls-remote` against GitHub's
      # nrwl/nx-ai-agents-config when an agent has both rules and Nx's MCP
      # configured; a cowshed sandbox runs Nx without a daemon.) It also makes
      # `nx migrate` run with the installed CLI instead of the newest one;
      # `NX_USE_LOCAL=false nx migrate` restores that for the one command.
      NX_USE_LOCAL = "true";
      TTSC_TYPESCRIPT_GO_DIR = "${typescriptGo}";
      SMOO_TYPECHECK_TSC = "${typecheckTsc}/bin/tsc";
    }
    # Playwright's downloaded Ubuntu browser has no runtime closure on NixOS
    # (CI reached the executable, then failed loading libglib-2.0.so.0). Use
    # the lock-pinned Nix browser and its libraries; smoo passes this executable
    # to the child before Playwright imports. Darwin keeps its native browser path.
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = lib.getExe pkgs.chromium;
    })
  ];

  # devenv's Cachix integration adds one substituter, devenv.cachix.org, whose
  # signing key it fetches from the Cachix API whenever its per-user key file
  # (cachix_trusted_keys.json) lacks it. That cache holds nothing this shell
  # pulls: its packages come from devenv-nixpkgs, whose store paths
  # cache.nixos.org already serves, and the rest are built here. Off, devenv
  # makes no network call before evaluating, which matters wherever the API is
  # unreachable (a cowshed sandbox's gateway, an offline host). A host that
  # wants the cache anyway names it in its own nix.conf.
  cachix.enable = false;

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
    # — ring, openssl-sys, libgit2-sys, libz-sys — additionally needs a C
    # compiler for the target, which is zig in the `linux-cross` toolchain
    # below, kept off every macOS shell and macOS runner.
    #
    # The reverse direction is not available at any price: type-checking an Apple
    # target from Linux needs an Apple SDK for those same C-building
    # dependencies, which is a licensing boundary rather than a missing package.
    targets =
      [
        "wasm32-unknown-unknown"
        "x86_64-unknown-linux-gnu"
      ]
      ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux linuxToolchain.languages.rust.targets;
  };

  # The Linux toolchain: zig, driven through cargo-zigbuild, plus the Linux
  # rust-std set. It builds every published Linux artifact — static musl CLIs,
  # glibc 2.17 N-API addons — and `check:linux`'s cross clippy, with the same
  # command on every host. zig carries glibc symbol-version stubs for every
  # glibc and the musl sources inside its own store path, so nothing on the
  # build machine reaches the artifact: no loader path, no RUNPATH, no build
  # host's glibc floor. cargo-zigbuild supplies the `zig cc` shims and per-triple
  # compiler variables itself, so this module sets no environment.
  #
  # A Linux host carries it in the base shell, because its ordinary `build`
  # includes its own platform's artifacts. A macOS host opts in through the
  # `linux-cross` profile, activated by `devenv -P linux-cross` and driven by
  # the root `check:linux` script: zig is a 380 MiB closure, about 0.9 GiB with
  # the three rust-std targets, and nothing else on Darwin needs it. devenv 2.2.3
  # has first-class profiles, so this is one gated module in the shared file
  # rather than a second config directory that would re-import and re-pin
  # everything here.
  #
  # The profile supplies the toolchain and nothing else. CARGO_BUILD_TARGET is
  # deliberately NOT set: the triple belongs to the Nx target that asks for it
  # (`cargo-lint-cross` passes `--target` explicitly), not to the ambient
  # environment. An ambient triple would make the check silently host-local
  # whenever the profile was forgotten — reporting green having compiled macOS.
  # With the flag on the target instead, running it outside this profile fails
  # loudly on the missing cargo-zigbuild, and a host lint can never be mistaken
  # for a cross one.
  profiles.linux-cross.module = {
    config = lib.mkIf (!pkgs.stdenv.hostPlatform.isLinux) linuxToolchain;
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
  # And it would not even pay: the Actions store cache is keyed on os+arch and
  # the devenv files and is blind to the profile, so a restore ships the whole
  # store regardless, while the save keeps the closure that job realized. A lean
  # publish job that won that immutable key would hand the CI workflow a store
  # with no toolchain in it. On any run where repair has work the saving is zero
  # anyway, because repair realizes the historical default shell inside the
  # same job.

  # One Go for every repository, same reasoning as the Rust toolchain: a compiler
  # is part of a cache key, so two of them mean two caches.
  # The typecheck compiler's Go 1.27 above is a build input of that one
  # derivation only: no shell, plugin or repository build ever runs it.
  #
  # Pinned to the patch release ttsc vendors inside its native package: ttsc
  # builds plugins with that SDK unless TTSC_GO_BINARY names another, so matching
  # it is how there is ONE Go rather than ours plus a dependency's. `smoo
  # monorepo check` enforces the match and fails with both versions when they
  # diverge, which is what makes this pin a maintained invariant instead of a
  # comment that rots.
  #
  # It needs its own input because the fleet's nixpkgs does not carry that patch:
  # devenv-nixpkgs rolling ships go 1.26.5, while ttsc 0.30.4 vendors go1.26.8.
  # Same idiom, and same reason, for any single-package pin — one leaf package
  # from a nixpkgs that has it, lock-pinned, prebuilt, rather than a fleet-wide
  # bump that would move rustc, bun and node too. Not every pairing is
  # reachable: ttsc 0.28.1/0.28.2 vendor go1.26.6, which NO channel packages, so
  # when no revision offers the vendored patch the ttsc pin is what moves.
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
      goPkgs.go
      pkgs.nodejs_26
      pkgs.binaryen
      # Smoo's GitHub Actions validator uses the managed prebuilt package above.
      pkgs.jactionlint
      # Keep jactionlint's default shell and Python checks in the same pinned closure.
      pkgs.shellcheck-minimal
      pyflakesBin
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
    ++ lib.optionals pkgs.stdenv.hostPlatform.isLinux ([pkgs.chromium] ++ linuxToolchain.packages);

  # devenv wraps the Python interpreter to find native libraries in
  # `languages.python.libraries`, whose default is this checkout's
  # `.devenv/profile`. That path then lands in the interpreter's store path, the
  # profile that holds it, PKG_CONFIG_PATH and the uv environment built with it,
  # so every clone evaluates and builds its own interpreter and profile on first
  # entry, every cache keyed on the build environment misses — ttsc hashes
  # PKG_CONFIG_PATH into its plugin key and rebuilds the Go plugin per clone —
  # and a copied uv environment names another checkout's interpreter. Cleared,
  # the interpreter is one store path in every checkout. devenv still adds the
  # C++ runtime; a wheel that needs another library names that library here.
  languages.python.libraries = lib.mkDefault [];

  # The stdenv build variables the shell derivation leaks beyond the ones devenv
  # already drops: generic names (`name`, `system`) that collide with any
  # script's own, and builder-only settings (NIX_CFLAGS_COMPILE,
  # SOURCE_DATE_EPOCH, the sandbox profiles) that change what a compiler run
  # from the shell produces. The shell is a place to run tools, not a builder.
  # mkOptionDefault: devenv's own default list stays, this one joins it.
  unsetEnvVars = lib.mkOptionDefault [
    "CONFIG_SHELL"
    "DETERMINISTIC_BUILD"
    "IN_NIX_SHELL"
    "MACOSX_DEPLOYMENT_TARGET"
    "NIX_CFLAGS_COMPILE"
    "NIX_COREFOUNDATION_RPATH"
    "NIX_DONT_SET_RPATH"
    "NIX_DONT_SET_RPATH_FOR_BUILD"
    "NIX_ENFORCE_NO_NATIVE"
    "NIX_IGNORE_LD_THROUGH_GCC"
    "NIX_INDENT_MAKE"
    "NIX_NO_SELF_RPATH"
    "NIX_STORE"
    "PATH_LOCALE"
    "SOURCE_DATE_EPOCH"
    "__darwinAllowLocalNetworking"
    "__impureHostDeps"
    "__propagatedImpureHostDeps"
    "__propagatedSandboxProfile"
    "__sandboxProfile"
    "cmakeFlags"
    "configureFlags"
    "mesonFlags"
    "name"
    "system"
  ];

  # Shell entry's installs are devenv tasks ordered before devenv:enterShell, so
  # devenv decides when they run and an unchanged checkout starts no installer.
  #
  # smoo:install runs `bun install` (and `uv sync` for a uv project) through
  # setup-environment.ts when anything they read changed: execIfModified keys
  # each file by content hash, by its path relative to tooling/direnv (so a
  # copy-on-write clone at another path is unchanged), honouring .gitignore.
  # The globs over-match (a fixture's package.json), which costs a no-op
  # install. node_modules/.smoo-install is the stamp a successful install
  # writes; named literally it is checked although node_modules is ignored, so
  # deleting node_modules reinstalls. The script keeps its own per-installer
  # digest under the install lock, so two shells entering at once install once.
  # The scripts themselves are inputs: a new setup-environment.ts reruns.
  #
  # smoo:cargo-fetch establishes what the Nx plugin's offline `cargo metadata
  # --locked` needs: every Cargo workspace's locked packages in CARGO_HOME. Its
  # stamps live in smoo's user cache and count only while CARGO_HOME names the
  # directory they were fetched into, which differs per host and per sandbox
  # and no checkout path can name, so it is gated by `status` (exit 0 when
  # CARGO_HOME holds them) rather than execIfModified.
  #
  # smoo:developer-links points the packages the root package.json's
  # `smoo.developerLinks` declares at their local checkouts, after an install
  # and in every tree that installed them (tooling/direnv/developer-links.ts).
  # Gated by `status` too: a clone or an install can lose a link without any
  # file devenv watches changing. Stale install links, including external Nx
  # aliases, run the managed Bun installer before declarations are applied.
  # A runner links nothing.
  #
  # A failed task does not fail shell entry (devenv reports it and the shell
  # still loads, so the tools to repair it stay available). CI runs both with
  # `devenv tasks run`, which does fail; setup-environment.ts is strict there.
  tasks = let
    setup = ''bun "$DEVENV_ROOT/setup-environment.ts"'';
  in {
    "smoo:install" = {
      description = "bun install / uv sync when what they read changed";
      exec = setup + lib.optionalString uvProject " --python ${python.package.interpreter}";
      execIfModified = [
        "../../package.json"
        "../../bun.lock"
        "../../bun.lockb"
        "../../bunfig.toml"
        "../../**/package.json"
        "../../**/*.patch"
        "../../pyproject.toml"
        "../../uv.lock"
        "../../**/pyproject.toml"
        "../../tooling/workspace.gitconfig"
        "setup-environment.ts"
        "developer-links.ts"
        "linked-snapshots.ts"
        "secret-references.ts"
        "../../node_modules/.smoo-install"
        "../../node_modules/@typescript/native/bin/tsc"
      ];
      before = ["devenv:enterShell"];
      showOutput = true;
    };
    "smoo:cargo-fetch" = {
      description = "cargo fetch --locked into CARGO_HOME for each Cargo workspace";
      exec = "${setup} --cargo";
      status = "${setup} --cargo --check";
      before = ["devenv:enterShell"];
      showOutput = true;
    };
    "smoo:developer-links" = {
      description = "repair stale install links and link declared local checkouts";
      exec = "${setup} --links";
      status = "${setup} --links --check";
      after = ["smoo:install"];
      before = ["devenv:enterShell"];
      showOutput = true;
    };
  };

  enterShell = lib.mkMerge [
    # Prologue, in order:
    #
    # 1. The devenv wrapper runs from tooling/direnv; every later step expects the
    #    workspace root.
    # 2. PATH order is most-specific → least-specific, the same list the git hooks
    #    use, so a hook and a shell resolve one binary the same way. The Rust
    #    toolchain's store bin then goes ahead of all of it (rustToolchainBin
    #    above): the same files the profile links, named by a path no checkout
    #    owns.
    # 3. ttsc drives the native TypeScript 7 binary while Nx imports the TypeScript
    #    6 API, so the two must be named separately.
    # 4. ttsc caches in the checkout's .cache/ttsc (the path the CI ttsc-plugin
    #    cache restores), its Go build cache in a directory of its own so
    #    `ttsc clean` can reclaim it: ttsc never deletes a GOCACHE it did not
    #    resolve itself, and sharing GOCACHE once left 35G nothing could empty.
    #    GOFLAGS carries -trimpath, Go's stable way to keep absolute build paths
    #    out of an artifact. A value the caller exported wins for each. Where Go
    #    and the machine-wide caches live otherwise is the host's or the
    #    sandbox's business, not this shell's.
    # 5. Dependencies are installed by the smoo:install and smoo:cargo-fetch
    #    tasks above, which devenv runs before this prologue; the prologue only
    #    activates what they installed.
    #
    #    The uv project environment is devenv's UV_PROJECT_ENVIRONMENT, synced
    #    with the interpreter devenv would use and activated here after the
    #    sync. It lives under this checkout and names no path of it: uv creates
    #    it relocatable, setup-environment.ts rewrites the editable installs of
    #    workspace members relative to it, and the interpreter is the same
    #    store path everywhere (languages.python.libraries above). A
    #    copy-on-write clone copies it along with everything else, installed.
    #    devenv's own virtualenv and uv sync tasks are refused below: they
    #    activate the environment from its own activation script — which in a
    #    clone names the original checkout — before this prologue runs, and key
    #    their skip on pyproject.toml alone.
    #
    #    A local install failure is reported and the shell still loads, so the
    #    tools to repair it stay available; CI fails. Repo-owned enterShell
    #    bodies merge after this prologue.
    # 6. Shell entry resolves the `shell` group of `smoo.secrets`, only when it
    #    installs, and nothing else. Shell entry happens on every direnv reload
    #    and every `devenv shell -- <command>`, and a provider command that runs
    #    then is a credential prompt on every one of them (1Password authorises
    #    per requesting process lineage, and this one is new each time). A
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
    # 8. On Darwin, Xcode answers for the Apple toolchain: nix CC/CXX, a
    #    nix-store SDKROOT and DEVELOPER_DIR, and every store PATH entry carrying
    #    nixpkgs xcbuild's `xcrun` are dropped, each one announced, so Xcode's
    #    clang compiles against the licensed SDK and `xcrun` is Apple's.
    #    tooling/direnv/apple-developer.sh does it and states why.
    # Nx's own socket fallback (under HOME or TMPDIR) can exceed the Unix socket
    # limit in a checkout, and an inherited NX_SOCKET_DIR may be another
    # workspace's: tooling/direnv/nx-socket-dir.sh, sourced below, names this
    # workspace's own, and binds NX_WORKSPACE_ROOT_PATH, which the smoo Nx
    # wrappers read to decide whether inherited Nx overrides belong to the root
    # they run.
    (lib.mkBefore ''
      cd "$DEVENV_ROOT/../.."
      # Direct `devenv shell` skips .envrc. Reuse cowshed's one environment writer
      # before project hooks, rather than restating its CI/compiler-cache policy.
      if [ -f .cowshed/env ]; then
        . "$PWD/.cowshed/env"
      fi
      export PATH="$("$PWD/tooling/direnv/repo-path")"
      export PATH="${rustToolchainBin}:$PATH"
      # devenv enters the shell with TMPDIR unset (not empty) on every platform.
      # Tools then fall back to /tmp, which on Darwin is not the per-user
      # temporary directory the OS hands out, and a test that asserts the
      # parent carries TMPDIR (so its env_clear check means something) fails in
      # the shell and passes outside it. Ask the OS; an explicit value wins.
      if [ -z "''${TMPDIR:-}" ]; then
        TMPDIR="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true)"
        export TMPDIR="''${TMPDIR:-/tmp}"
      fi
      # ttsc's compiler and caches: tooling/direnv/ttsc-env.sh, shared with the
      # git hooks, which run outside this shell. It reads the inherited
      # NX_WORKSPACE_ROOT_PATH, so it runs before nx-socket-dir.sh rebinds it.
      . "$DEVENV_ROOT/ttsc-env.sh"
      export GOFLAGS="''${GOFLAGS:--trimpath}"
      unset GOROOT
      ${lib.optionalString uvProject ''
        if [ -f pyproject.toml ]; then
          export VIRTUAL_ENV="$UV_PROJECT_ENVIRONMENT"
          export PATH="$VIRTUAL_ENV/bin:$PATH"
        fi
      ''}
      # Nx's workspace root and socket dir: tooling/direnv/nx-socket-dir.sh
      # gives every workspace its own socket dir, and in a cowshed checkout the
      # one literal path its host shells and sandboxed jobs all share, and
      # states why.
      . "$DEVENV_ROOT/nx-socket-dir.sh"
      ${lib.optionalString pkgs.stdenv.isDarwin ''
        . "$DEVENV_ROOT/apple-developer.sh" /nix/store
      ''}
    '')
    # Epilogue, after every project step (a project's own enterShell may resolve
    # SDKROOT/compilers; the toolchain identity must see the final values). The
    # stamp logic lives in toolchain-stamp.ts; see its header for why.
    (lib.mkAfter ''
          # Project hooks may prepend real Cargo. Reuse the managed PATH writer
      # last: its served install identity is the host's, not the private HOME.
      export PATH="$("$DEVENV_ROOT/repo-path")"
      bun "$DEVENV_ROOT/toolchain-stamp.ts" || exit $?
      if [ -n "$DEVENV_SHELL_PWD" ]; then
        cd "$DEVENV_SHELL_PWD"
      fi
    '')
  ];

  assertions = [
    {
      assertion = !(uvProject && (python.venv.enable || python.uv.sync.enable));
      message = ''
        devenv.smoo.nix syncs and activates the uv project environment itself (enterShell item 5).
        Set languages.python.venv.enable and languages.python.uv.sync.enable to false in devenv.nix:
        devenv's tasks activate the environment from its own activation script, which in a
        copy-on-write clone names the original checkout, and skip the sync while uv.lock changes.
      '';
    }
  ];
}
