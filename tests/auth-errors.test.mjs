import test from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../lib/auth-errors.mjs';

test('distinguishes rejected credentials from a connection failure', () => {
  const rejected = authErrorMessage({ message: 'No user found with that email, or password invalid.', cause: { status: 400 } });
  assert.match(rejected, /Неправильний email або пароль/);
  assert.match(authErrorMessage(new TypeError('Failed to fetch')), /Перевірте інтернет/);
});

test('explains confirmation, duplicate signup, and rate limits', () => {
  assert.match(authErrorMessage(new Error('Email not confirmed')), /Email ще не підтверджено/);
  assert.match(authErrorMessage(new Error('A user with this email address has already been registered'), 'signup'), /уже існує/);
  assert.match(authErrorMessage({ cause: { status: 429 } }), /Забагато спроб/);
});

test('does not disclose unknown server responses', () => {
  assert.equal(authErrorMessage(new Error('private server details'), 'signup'), 'Не вдалося створити акаунт. Спробуйте пізніше або увійдіть, якщо вже реєструвалися.');
});

test('explains confirmation delivery failure instead of blaming the connection', () => {
  assert.match(authErrorMessage(new Error('Error sending confirmation mail'), 'signup'), /Не вдалося надіслати лист підтвердження/);
});
