// Show only known, translated errors; never expose raw server responses.
export function authErrorMessage(error, operation = 'login') {
  const message = String(error?.message || error?.cause?.message || '').toLowerCase();
  const status = Number(error?.status || error?.cause?.status || 0);

  if (status === 429 || /too many|rate limit|too frequently/.test(message)) {
    return 'Забагато спроб. Зачекайте кілька хвилин і спробуйте ще раз.';
  }
  if (/not confirmed|not verified|confirm your|confirmation required/.test(message)) {
    return 'Email ще не підтверджено. Відкрийте лист від Netlify та перейдіть за посиланням підтвердження. Перевірте також папку «Спам».';
  }
  if (/already registered|already been registered|already exists|already signed up|email.*in use/.test(message)) {
    return 'Обліковий запис із цим email уже існує. Увійдіть або скористайтеся посиланням «Забули пароль?» на сторінці входу.';
  }
  if (/signup.*disabled|signups.*not allowed|registration.*disabled|invite only/.test(message)) {
    return 'Реєстрація доступна лише за запрошенням.';
  }
  if (/sending.*(email|mail)|send.*confirmation|smtp|mailer/.test(message)) {
    return 'Не вдалося надіслати лист підтвердження. Спробуйте пізніше. Якщо акаунт уже створено, скористайтеся відновленням пароля на сторінці входу.';
  }
  if (/password.*(short|least|weak)|weak.*password/.test(message) || (operation === 'signup' && /requires a valid password/.test(message))) {
    return 'Пароль має містити щонайменше 8 символів.';
  }
  if (/invalid email|valid email address|email address.*invalid/.test(message)) {
    return 'Перевірте правильність email-адреси.';
  }
  if (operation === 'login' && (status === 400 || status === 401 || /invalid.*(credentials|password|grant)|no user found|email.*password/.test(message))) {
    return 'Неправильний email або пароль. Перевірте дані або натисніть «Забули пароль?».';
  }
  if (/failed to fetch|network|load failed|timed out|timeout/.test(message)) {
    return 'Не вдалося з’єднатися із сервісом авторизації. Перевірте інтернет і спробуйте ще раз.';
  }
  return operation === 'signup'
    ? 'Не вдалося створити акаунт. Спробуйте пізніше або увійдіть, якщо вже реєструвалися.'
    : 'Не вдалося виконати вхід. Спробуйте пізніше або скористайтеся відновленням пароля.';
}
