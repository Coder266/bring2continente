{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.bring2continente;
  dataDir = "/var/lib/bring2continente";
in
{
  options.services.bring2continente = {
    enable = lib.mkEnableOption "the bring2continente Bring! → Continente bridge";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./package.nix { }";
      description = "The bring2continente package.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address the web UI listens on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8093;
      description = "Web UI and API port.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.either lib.types.path (lib.types.listOf lib.types.path);
      description = ''
        File (or list of files) with the secrets and settings from .env.example
        (BRING_EMAIL, BRING_PASSWORD, BRING_LIST, CONTINENTE_EMAIL,
        CONTINENTE_PASSWORD, WEB_PASSWORD, SESSION_SECRET, ...). Keep it outside
        the Nix store.
      '';
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "bring2continente";
      description = "System user running the service.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "bring2continente";
      description = "System group running the service.";
    };

    createUser = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Create the service user/group. Set to false to run as an existing user
        (for example, the same user that owns the OpenCode CLI and its auth).
      '';
    };

    home = lib.mkOption {
      type = lib.types.str;
      default = dataDir;
      description = "HOME for the service. Point this at the OpenCode user's home when using the model picker.";
    };

    protectHome = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Apply systemd ProtectHome. Must be false when running as a real user with a home directory.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the web UI port globally. Prefer a Tailscale/LAN-only rule.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups = lib.mkIf cfg.createUser { ${cfg.group} = { }; };
    users.users = lib.mkIf cfg.createUser {
      ${cfg.user} = {
        isSystemUser = true;
        group = cfg.group;
        home = cfg.home;
        createHome = false;
        description = "bring2continente service user";
      };
    };

    systemd.services.bring2continente = {
      description = "Bring! → Continente cart bridge";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment = {
        NODE_ENV = "production";
        HOST = cfg.host;
        PORT = toString cfg.port;
        DATA_DIR = dataDir;
        CONTINENTE_DATA_DIR = "${dataDir}/continente";
        HOME = cfg.home;
        UI_DIR = "${cfg.package}/lib/bring2continente/dist/web";
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        CONTINENTE_UPDATE_CHECK = "0";
      };

      serviceConfig = {
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = "${cfg.package}/lib/bring2continente";
        ExecStart = "${cfg.package}/bin/bring2continente";
        EnvironmentFile = cfg.environmentFile;
        Restart = "on-failure";
        RestartSec = 5;
        StateDirectory = "bring2continente";
        StateDirectoryMode = "0700";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = cfg.protectHome;
        ReadWritePaths = [ dataDir ];
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
          "AF_NETLINK"
        ];
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
