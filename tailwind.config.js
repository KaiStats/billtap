/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
  			display: ['"Inter Tight"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  			mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)',
  			'2xl': 'calc(var(--radius) + 6px)',
  			'3xl': 'calc(var(--radius) + 14px)'
  		},
  		boxShadow: {
  			card: 'var(--shadow-md)',
  			float: 'var(--shadow-lg)',
  			glow: 'var(--glow-teal)',
  		},
  		transitionTimingFunction: {
  			'out-expo': 'cubic-bezier(0.23, 1, 0.32, 1)',
  			'in-out-expo': 'cubic-bezier(0.77, 0, 0.175, 1)',
  			drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			brand: {
  				DEFAULT: 'hsl(var(--brand))',
  				foreground: 'hsl(var(--brand-foreground))',
  				muted: 'hsl(var(--brand-muted))',
  				'muted-foreground': 'hsl(var(--brand-muted-foreground))',
  			},
  			success: {
  				DEFAULT: 'hsl(var(--success))',
  				muted: 'hsl(var(--success-muted))',
  				'muted-foreground': 'hsl(var(--success-muted-foreground))',
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--warning))',
  				muted: 'hsl(var(--warning-muted))',
  				'muted-foreground': 'hsl(var(--warning-muted-foreground))',
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				muted: 'hsl(var(--info-muted))',
  				'muted-foreground': 'hsl(var(--info-muted-foreground))',
  			},
  			danger: {
  				muted: 'hsl(var(--danger-muted))',
  				'muted-foreground': 'hsl(var(--danger-muted-foreground))',
  			},
  			surface: {
  				DEFAULT: 'hsl(var(--surface))',
  				raised: 'hsl(var(--surface-raised))',
  			},
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
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}