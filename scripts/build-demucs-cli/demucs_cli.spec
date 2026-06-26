# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for demucs_cli.exe

a = Analysis(
    ['launch_demucs.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('demucs/remote/*', 'demucs/remote'),
    ],
    hiddenimports=[
        'pkg_resources.py2_warn',
        'torch',
        'torchvision',
        'torchaudio',
        'torch.nn',
        'torch.distributed',
        'demucs.separate',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
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
    name='demucs_cli',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
