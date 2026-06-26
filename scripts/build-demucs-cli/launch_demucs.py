"""
Demucs CLI 入口，供 PyInstaller 打包为 demucs_cli.exe
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from demucs.separate import main

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
