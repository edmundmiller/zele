{
  description = "zele - Gmail CLI and TUI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Runtime
            bun                    # Primary runtime for TUI and dev
            nodejs_22              # Fallback runtime for CLI commands
            
            # Database
            sqlite                 # For local DB inspection
            prisma-engines         # Required for Prisma codegen on NixOS
            
            # Development tools
            typescript
            nodePackages.typescript-language-server
          ];

          shellHook = ''
            echo "🌊 zele dev environment"
            echo ""
            echo "Quick start:"
            echo "  bun install              # Install dependencies"
            echo "  bun run build            # Build the project"
            echo "  bun src/cli.ts           # Run CLI locally"
            echo "  npm install -g .         # Install globally for testing"
            echo ""
            echo "Prisma (NixOS-specific):"
            echo "  The prisma-engines are available in your PATH"
            echo "  bun run generate         # Generate Prisma client"
            echo ""
            echo "Testing TUI:"
            echo "  zele                     # Launch TUI (after global install)"
            echo ""

            # Make prisma-engines available to Prisma
            export PRISMA_QUERY_ENGINE_BINARY="${pkgs.prisma-engines}/bin/query-engine"
            export PRISMA_SCHEMA_ENGINE_BINARY="${pkgs.prisma-engines}/bin/schema-engine"
            export PRISMA_MIGRATION_ENGINE_BINARY="${pkgs.prisma-engines}/bin/migration-engine"
            export PRISMA_FMT_BINARY="${pkgs.prisma-engines}/bin/prisma-fmt"
          '';
        };
      }
    );
}
