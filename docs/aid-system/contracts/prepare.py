#!/usr/bin/env python3
"""Compatibility generation entry point; does not rewrite source documents."""
import runpy,sys
from pathlib import Path
sys.argv=[sys.argv[0],'generate']
runpy.run_path(str(Path(__file__).resolve().parents[1]/'tools/design.py'),run_name='__main__')
