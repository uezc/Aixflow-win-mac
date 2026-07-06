# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for rvc_infer_cli.exe

a = Analysis(
    ['launch_rvc_infer.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'torch',
        'torchaudio',
        'torch.nn',
        'infer_rvc_python',
        'rvc_python',
        'fairseq',
        'librosa',
        'soundfile',
        'faiss',
        'sklearn',
        'scipy',
        'numba',
        'bitarray',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['gradio', 'matplotlib', 'tkinter'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='rvc_infer_cli',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
