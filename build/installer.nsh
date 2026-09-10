# 覆盖安装修复（Windows：不卸载旧版即可升级）
#
# 症状（A 类「卸载失败」）：双击新版 Setup.exe 时卸载旧版失败/被占用，
# electron-builder 默认逻辑弹「uninstallFailed」后 SetErrorLevel 2 + Quit，
# 安装中断，只能手动去「应用和功能」卸载后才能装新版。
#
# 根因（见 app-builder-lib/templates/nsis/include/installUtil.nsh）：
#   ExecWait 旧版卸载器 → $R0 非 0 → handleUninstallResult 直接 Quit。
# 文件被占用（进程未退、杀毒、资源管理器预览锁）时旧卸载器返回非 0。
#
# 修复：
# 1. customUnInstallCheck —— handleUninstallResult 检测到该宏存在时会执行并立即
#    Return（跳过默认报错分支），这里清错误并把返回码置 0，安装继续。
#    NSIS 文件复制本就可覆盖在用文件（延迟删除），失败也只回滚该文件。
# 2. customInit —— 安装启动前静默结束旧进程，从源头减少文件占用。
#    注意：自定义宏在模板 !include common.nsh 之后才加载，
#    必须包 !ifndef BUILD_UNINSTALLER（卸载器编译上下文无 LogText / customInit）。
!ifndef BUILD_UNINSTALLER

!macro customInit
  # $appExe 此时尚未赋值（它在 install Section 才初始化），用编译期宏
  ExecWait 'taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /t' $0
  Sleep 500
!macroend

!macro customUnInstallCheck
  ClearErrors
  StrCpy $R0 0
!macroend

!endif
