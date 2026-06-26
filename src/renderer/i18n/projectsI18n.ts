import type { AppLocale } from './settingsI18n';

export type ProjectsStrings = {
  loadingList: string;
  backHome: string;
  myProjects: string;
  saveLocation: string;
  chooseSaveLocation: string;
  chooseSaveLocationTitle: string;
  importProject: string;
  importProjectTitle: string;
  newProject: string;
  newProjectTitle: string;
  modified: string;
  confirm: string;
  cancel: string;
  projectNamePlaceholder: string;
  editProjectTitle: string;
  exportTitle: string;
  deleteTitle: string;
  newProjectHeading: string;
  placeholderNewProjectName: string;
  create: string;
  quitAppTitle: string;
  quitAppAria: string;
  /** 返回账户登录 / 设置页 */
  cloudAccount: string;
  cloudAccountTitle: string;
};

const zh: ProjectsStrings = {
  loadingList: '正在加载项目列表...',
  backHome: '返回主页',
  myProjects: '我的项目',
  saveLocation: '保存位置:',
  chooseSaveLocation: '选择保存位置',
  chooseSaveLocationTitle: '选择项目保存位置（默认在软件安装目录下 projects 文件夹）',
  importProject: '导入项目',
  importProjectTitle: '导入项目',
  newProject: '新建项目',
  newProjectTitle: '新建项目',
  modified: '修改:',
  confirm: '确认',
  cancel: '取消',
  projectNamePlaceholder: '项目名称',
  editProjectTitle: '编辑项目',
  exportTitle: '导出项目',
  deleteTitle: '删除项目',
  newProjectHeading: '新建项目',
  placeholderNewProjectName: '请输入项目名称',
  create: '创建',
  quitAppTitle: '退出软件',
  quitAppAria: '退出软件',
  cloudAccount: '返回登陆',
  cloudAccountTitle: '返回账户登录与设置页',
};

const en: ProjectsStrings = {
  loadingList: 'Loading projects…',
  backHome: 'Back',
  myProjects: 'My projects',
  saveLocation: 'Save location:',
  chooseSaveLocation: 'Choose folder',
  chooseSaveLocationTitle: 'Choose where new projects are saved',
  importProject: 'Import',
  importProjectTitle: 'Import project',
  newProject: 'New project',
  newProjectTitle: 'New project',
  modified: 'Modified:',
  confirm: 'OK',
  cancel: 'Cancel',
  projectNamePlaceholder: 'Project name',
  editProjectTitle: 'Rename project',
  exportTitle: 'Export project',
  deleteTitle: 'Delete project',
  newProjectHeading: 'New project',
  placeholderNewProjectName: 'Project name',
  create: 'Create',
  quitAppTitle: 'Quit application',
  quitAppAria: 'Quit application',
  cloudAccount: 'Back to login',
  cloudAccountTitle: 'Back to account sign-in and settings',
};

export function projectsT(locale: AppLocale): ProjectsStrings {
  return locale === 'en' ? en : zh;
}
