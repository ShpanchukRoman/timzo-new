'use client';
import { useEffect } from 'react';
import { getUser, onAuthChange, AUTH_EVENTS } from '@netlify/identity';
export default function IdentitySession() {
  useEffect(() => {
    getUser();
    return onAuthChange(event => {
      if (event === AUTH_EVENTS.LOGOUT) window.location.replace('/login');
    });
  }, []);
  return null;
}
