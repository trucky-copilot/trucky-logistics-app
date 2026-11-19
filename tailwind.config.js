/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
    safelist: [
      "text-green-400", "text-yellow-400", "text-red-400",
      "bg-green-400/10", "bg-yellow-400/10", "bg-red-400/10",
      "border-green-400/30", "border-yellow-400/30", "border-red-400/30",
      "text-violet-400", "bg-violet-400/10", "border-violet-400/20", "border-violet-400/25", "bg-violet-400/8",
      "text-cyan-400", "bg-cyan-400/10", "border-cyan-400/30", "bg-cyan-400/8",
    ],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        card: 'var(--t-shadow-card)',
        popover: 'var(--t-shadow-popover)',
        glow: 'var(--t-shadow-glow)',
        focus: 'var(--t-ring-focus)',
      },
      borderRadius: {
        xl2: '24px',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        // Tokens del Figma (Trucky — Design System): t-bg-canvas, t-text-accent, …
        t: {
          'bg-canvas': 'rgb(var(--t-bg-canvas) / <alpha-value>)',
          'bg-sidebar': 'rgb(var(--t-bg-sidebar) / <alpha-value>)',
          'bg-surface': 'rgb(var(--t-bg-surface) / <alpha-value>)',
          'bg-surface-raised': 'rgb(var(--t-bg-surface-raised) / <alpha-value>)',
          'bg-input': 'rgb(var(--t-bg-input) / <alpha-value>)',
          'bg-deep': 'rgb(var(--t-bg-deep) / <alpha-value>)',
          'bg-inverse': 'rgb(var(--t-bg-inverse) / <alpha-value>)',
          'text-primary': 'rgb(var(--t-text-primary) / <alpha-value>)',
          'text-secondary': 'rgb(var(--t-text-secondary) / <alpha-value>)',
          'text-muted': 'rgb(var(--t-text-muted) / <alpha-value>)',
          'text-accent': 'rgb(var(--t-text-accent) / <alpha-value>)',
          'text-on-accent': 'rgb(var(--t-text-on-accent) / <alpha-value>)',
          'text-disabled': 'rgb(var(--t-text-disabled) / <alpha-value>)',
          'text-inverse': 'rgb(var(--t-text-inverse) / <alpha-value>)',
          'border-default': 'rgb(var(--t-border-default) / <alpha-value>)',
          'border-strong': 'rgb(var(--t-border-strong) / <alpha-value>)',
          'border-subtle': 'rgb(var(--t-border-subtle) / <alpha-value>)',
          'border-focus': 'rgb(var(--t-border-focus) / <alpha-value>)',
          'action-primary': 'rgb(var(--t-action-primary) / <alpha-value>)',
          'action-primary-hover': 'rgb(var(--t-action-primary-hover) / <alpha-value>)',
          'action-primary-pressed': 'rgb(var(--t-action-primary-pressed) / <alpha-value>)',
          'action-secondary': 'rgb(var(--t-action-secondary) / <alpha-value>)',
          'action-secondary-hover': 'rgb(var(--t-action-secondary-hover) / <alpha-value>)',
          'action-disabled': 'rgb(var(--t-action-disabled) / <alpha-value>)',
          'accent-brand': 'rgb(var(--t-accent-brand) / <alpha-value>)',
          'accent-lime': 'rgb(var(--t-accent-lime) / <alpha-value>)',
          'accent-cyan': 'rgb(var(--t-accent-cyan) / <alpha-value>)',
          'success': 'rgb(var(--t-success) / <alpha-value>)',
          'success-soft': 'rgb(var(--t-success-soft) / <alpha-value>)',
          'warning': 'rgb(var(--t-warning) / <alpha-value>)',
          'warning-soft': 'rgb(var(--t-warning-soft) / <alpha-value>)',
          'danger': 'rgb(var(--t-danger) / <alpha-value>)',
          'danger-soft': 'rgb(var(--t-danger-soft) / <alpha-value>)',
          'info': 'rgb(var(--t-info) / <alpha-value>)',
          'info-soft': 'rgb(var(--t-info-soft) / <alpha-value>)',
          'chart-1': 'rgb(var(--t-chart-1) / <alpha-value>)',
          'chart-2': 'rgb(var(--t-chart-2) / <alpha-value>)',
          'chart-3': 'rgb(var(--t-chart-3) / <alpha-value>)',
          'chart-4': 'rgb(var(--t-chart-4) / <alpha-value>)',
          'chart-5': 'rgb(var(--t-chart-5) / <alpha-value>)',
          'chart-grid': 'rgb(var(--t-chart-grid) / <alpha-value>)',
          'chat-bubble-user': 'rgb(var(--t-chat-bubble-user) / <alpha-value>)',
          'chat-on-bubble-user': 'rgb(var(--t-chat-on-bubble-user) / <alpha-value>)',
          'logo-fill': 'rgb(var(--t-logo-fill) / <alpha-value>)'
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        },
        sidebar: {
          DEFAULT: 'hsl(var(--background))',
          foreground: 'hsl(var(--foreground))',
          primary: 'hsl(var(--primary))',
          'primary-foreground': 'hsl(var(--primary-foreground))',
          accent: 'hsl(var(--muted))',
          'accent-foreground': 'hsl(var(--foreground))',
          border: 'hsl(var(--border))',
          ring: 'hsl(var(--ring))'
        }
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        },
        'pulse-cyan': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-cyan': 'pulse-cyan 2s ease-in-out infinite'
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
}
