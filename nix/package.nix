{ lib, buildNpmPackage, nodejs_24, makeWrapper, playwright-driver }:

buildNpmPackage {
  pname = "bring2continente";
  version = "0.1.0";

  src = ../.;
  npmDepsHash = "sha256-G393WDnTnlri525AoF+n89twloLMWtQpHfhWFMtQX2k=";
  npmFlags = [ "--no-audit" "--no-fund" ];

  env = {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  };

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/bring2continente $out/bin
    npm prune --omit=dev --no-audit --no-fund
    cp -r dist $out/lib/bring2continente/dist
    cp -r node_modules $out/lib/bring2continente/node_modules
    cp package.json $out/lib/bring2continente/package.json

    makeWrapper ${nodejs_24}/bin/node $out/bin/bring2continente \
      --add-flags "$out/lib/bring2continente/dist/index.js" \
      --set-default UI_DIR "$out/lib/bring2continente/dist/web" \
      --set-default CONTINENTE_MCP_COMMAND "${nodejs_24}/bin/node" \
      --set-default CONTINENTE_MCP_ARGS "$out/lib/bring2continente/node_modules/continentept-mcp/dist/cli.js" \
      --set-default PLAYWRIGHT_BROWSERS_PATH "${playwright-driver.browsers}" \
      --prefix PATH : "${nodejs_24}/bin"
    runHook postInstall
  '';

  meta = {
    description = "Mirror a Bring! list into a Continente cart with dietary guardrails";
    homepage = "https://github.com/Coder266/bring2continente";
    license = lib.licenses.mit;
    mainProgram = "bring2continente";
    platforms = lib.platforms.linux;
  };
}
