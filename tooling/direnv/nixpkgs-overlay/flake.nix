{
  outputs = {...}: {
    overlays.default = self: super:
      with super; let
        sources = callPackage ./_sources/generated.nix {};
        bunSource = sources."bun-${stdenvNoCC.hostPlatform.system}";
      in {
        # Override bun with the version from nvfetcher
        bun = bun.overrideAttrs (finalAttrs: previousAttrs: {
          inherit (bunSource) version src;
        });
      };
  };
}
