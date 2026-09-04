# Compatibility store modules

This directory is retained temporarily so existing imports remain stable while state moves to its owning feature or the application layer.

Do not add new store implementations here. Every TypeScript module in this directory should be a documented re-export facade. Remove a facade only after repository search confirms all call sites use the canonical feature path.
