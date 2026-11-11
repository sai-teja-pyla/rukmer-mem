export function canvasSkipsPrivate(url: string, includeGrades: boolean) {
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return true;
  }
  const grades = /\/grades?(?:\/|$)|\/gradebook|\/submissions(?:\/|$)/.test(path);
  const otherStudent = /\/users\/(?!$|self(?:\/|$))/.test(path);
  if (!includeGrades && (grades || otherStudent)) return true;
  return false;
}

export function canvasKind(url: string) {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (path.includes('/assignments')) return 'assignment';
  if (path.includes('/announcements') || path.includes('/discussion_topics')) return path.includes('/announcements') ? 'announcement' : 'discussion';
  if (path.includes('/pages') || path.includes('/wiki')) return 'page';
  if (path.includes('/modules')) return 'module';
  if (path.includes('/syllabus')) return 'syllabus';
  if (path.includes('/calendar') || path.includes('/todo')) return 'calendar';
  return '';
}
