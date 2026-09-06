import { test, expect, type Page } from '@playwright/test';
const fixture = 'http://127.0.0.1:3119';
async function requests(page: Page) { return (await page.request.get(`${fixture}/_test/requests`)).json(); }
async function signIn(page: Page) {
  await page.goto('/auth?next=/account');
  await page.getByLabel('Email address', { exact: true }).fill('fixture@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('Fixture-password-2026');
  await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your account.'})).toBeVisible();
}
test.beforeEach(async ({ page }) => { await page.request.get(`${fixture}/_test/reset`); });

test('protected account redirects logged-out visitors and preserves their destination', async ({page}) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/auth\?next=%2Faccount$/);
  await expect(page.getByRole('button',{name:'Save password',exact:true})).toHaveCount(0);
});

test('signup resend uses confirmation endpoint and cooldown survives changing modes', async ({page}) => {
  await page.clock.install();
  await page.goto('/auth');
  await page.getByRole('button',{name:'Sign up',exact:true}).click();
  await page.getByLabel('Email address',{exact:true}).fill('fixture@example.invalid');
  await page.getByLabel('Password',{exact:true}).fill('Fixture-password-2026');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('needs confirmation');
  await expect(page.getByRole('button',{name:/Resend in/})).toBeDisabled();
  await page.clock.runFor(61_000);
  await page.getByRole('button',{name:'Resend email',exact:true}).click();
  await expect.poll(async()=> (await requests(page)).filter((x:{path:string})=>x.path==='/auth/v1/resend').length).toBe(1);
  expect((await requests(page)).filter((x:{path:string})=>x.path==='/auth/v1/signup')).toHaveLength(1);
  await page.getByRole('button',{name:'Back to sign in',exact:true}).click();
  await page.getByRole('button',{name:'Resend account confirmation',exact:true}).click();
  await expect(page.getByRole('button',{name:/Try again in/})).toBeDisabled();
});

test('email codes handle expiration, establish a session and never enter the URL', async ({page}) => {
  await page.goto('/auth?next=/account');
  await page.getByRole('button',{name:'Email me a sign-in code instead'}).click();
  await page.getByLabel('Email address',{exact:true}).fill('fixture@example.invalid');
  await page.getByRole('button',{name:'Email sign-in code',exact:true}).click();
  await page.getByLabel('Sign-in code',{exact:true}).fill('000000');
  await page.getByRole('button',{name:'Verify code',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('expired or has already been used');
  await page.getByLabel('Sign-in code',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'Verify code',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your account.'})).toBeVisible();
  expect(page.url()).not.toContain('123456');
  expect(page.url()).not.toContain('token');
});

test('account password validation and all-device logout use the authenticated session', async ({page}) => {
  await signIn(page);
  await page.getByLabel('New password',{exact:true}).fill('Fixture-new-password');
  await page.getByLabel('Confirm new password',{exact:true}).fill('different');
  await page.getByRole('button',{name:'Save password',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('Passwords don’t match.');
  expect((await requests(page)).filter((x:{method:string})=>x.method==='PUT')).toHaveLength(0);
  await page.getByLabel('Confirm new password',{exact:true}).fill('Fixture-new-password');
  await page.getByRole('button',{name:'Save password',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Your new password is ready to use.');
  await page.getByRole('button',{name:'Sign out all devices',exact:true}).click();
  await expect(page).toHaveURL(/\/auth$/);
  expect((await requests(page)).some((x:{path:string,scope:string})=>x.path==='/auth/v1/logout'&&x.scope==='global')).toBe(true);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/auth\?next=%2Faccount$/);
});

test('sign-in errors are actionable without reflecting private provider details', async ({page}) => {
  await page.goto('/auth');
  await page.getByLabel('Email address',{exact:true}).fill('wrong@example.invalid');
  await page.getByLabel('Password',{exact:true}).fill('Fixture-password');
  await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('email or password is incorrect');
  await expect(page.locator('main').getByRole('alert')).not.toContainText('Private backend');
});
