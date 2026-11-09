{
  description = "bring2continente — a Bring! list that fills a Continente cart safely";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        rec {
          default = bring2continente;
          bring2continente = pkgs.callPackage ./nix/package.nix { };
        }
      );

      nixosModules.default = ./nix/module.nix;

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.playwright-driver.browsers
              pkgs.openssl
            ];
            shellHook = ''
              export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
              echo "bring2continente dev shell — node $(node --version)"
            '';
          };
        }
      );
    };
}
