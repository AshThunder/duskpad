// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Chris Gold
/** DuskPad design tokens. The palette, type scale and radii follow the Material-3 style
 *  system used in Chris Gold's Dutch Auction UI, re-themed for "dusk". */
import forms from '@tailwindcss/forms';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1c1c1e',
        surface: '#fdf7ff',
        'surface-low': '#f8f2fa',
        'surface-mid': '#f2ecf4',
        'surface-high': '#ece6ee',
        'surface-highest': '#e6e0e9',
        'surface-dim': '#ded8e0',
        'on-surface': '#1d1b20',
        'on-surface-variant': '#494551',
        outline: '#7a7582',
        'outline-variant': '#cbc4d2',
        primary: '#4f378a',
        'primary-container': '#6750a4',
        'primary-fixed': '#e9ddff',
        'on-primary': '#ffffff',
        secondary: '#63597c',
        'secondary-container': '#e1d4fd',
        tertiary: '#765b00',
        'tertiary-container': '#c9a74d',
        'tertiary-fixed': '#ffdf93',
        error: '#ba1a1a',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',
        success: '#0f7a3d',
        'success-container': '#c9f2d6',
        mint: '#c3faf5',
        lilac: '#e1d4fd',
        butter: '#ffdf93',
        blush: '#ffdad6',
        terminal: '#00e676',
        dusk: { 900: '#1a1033', 700: '#4f378a', 500: '#9a5fb0', 300: '#e7a24b' },
      },
      fontFamily: {
        display: ['Epilogue', 'system-ui', 'sans-serif'],
        body: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-xl': ['80px', { lineHeight: '1.02', letterSpacing: '-0.04em', fontWeight: '700' }],
        'display-lg': ['56px', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-md': ['44px', { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '700' }],
        headline: ['32px', { lineHeight: '1.2', fontWeight: '600' }],
        label: ['12px', { lineHeight: '1', letterSpacing: '0.1em', fontWeight: '700' }],
      },
      borderRadius: { card: '28px', panel: '24px' },
      maxWidth: { page: '1360px' },
      boxShadow: {
        card: '0px 4px 20px rgba(0,0,0,0.04)',
        lift: '0px 16px 40px rgba(0,0,0,0.08)',
        tint: '0px 4px 10px rgba(0,0,0,0.05)',
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { rise: 'rise .35s ease-out both', shimmer: 'shimmer 1.6s linear infinite' },
    },
  },
  plugins: [forms],
};
