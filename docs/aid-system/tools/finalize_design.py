#!/usr/bin/env python3
"""Compatibility entry point. All generation/validation lives in design.py."""
import sys
from design import main
args=sys.argv[1:]
command='generate' if '--write' in args else 'check'
if '--out' in args: command='export'
args=[a for a in args if a not in ('--write','--check','--skip-network','--network')]
sys.argv=[sys.argv[0],command]+args
main()
