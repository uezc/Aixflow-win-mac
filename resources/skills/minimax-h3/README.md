# MiniMax-H3 Prompt Writing Skill（本地镜像）

本目录为 [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) 仓库 `skills/h3-prompt-writing` 的本地副本，供 Aixflow / NEXFLOW 主进程读取，用于「一键优化提示词」（H3 结构化改写）。

## 来源

- 官方技能目录：https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills
- 本技能路径：https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing
- Raw（main 分支）示例：
  - https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/SKILL.md
  - https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt
  - https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/ref-en.txt

## 已拉取文件

- `h3-prompt-writing/SKILL.md` — Workflow 与输出规则
- `h3-prompt-writing/references/base-en.txt` — 文生/图生等基础模式三段结构
- `h3-prompt-writing/references/ref-en.txt` — 多参/原音等 Full-Reference 六段结构
- `h3-prompt-writing/agents/openai.yaml` — Agent 展示元数据（可选）

## 许可证与声明

- 内容版权与许可遵循上游仓库 License（见 https://github.com/MiniMax-AI/MiniMax-H3 ）。
- 本应用仅为本地使用与产品功能集成而镜像；**不声称官方托管、不提供技能分发服务**。
- 上游更新时请自行对照官方路径重新拉取并覆盖本目录对应文件。

## 使用说明

应用内「优化提示词」（默认快捷键 `Ctrl+Shift+H`）会按当前 MiniMax-H3 模型选择 base / ref 指南，经现有 LLM 上游改写提示词。改写需联网调用对话模型。
