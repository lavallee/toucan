import { DEFAULT_THEME, type TLTheme, type TLThemeColors } from 'tldraw'

declare module '@tldraw/tlschema' {
	interface TLThemes { press: TLTheme; admiralty: TLTheme }
}

function ink(colors: TLThemeColors['black'], solid: string, semi: string) {
	return { ...colors, solid, semi, fill: solid, pattern: solid, linedFill: solid, frameStroke: solid, frameFill: semi, frameHeadingStroke: solid, frameHeadingFill: semi, frameText: solid }
}

function pressColors(dark: boolean): TLThemeColors {
	const colors = DEFAULT_THEME.colors[dark ? 'dark' : 'light']
	const background = dark ? '#202522' : '#f7f2e6'
	const text = dark ? '#f4e9d3' : '#302f28'
	return {
		...colors, background, text,
		black: ink(colors.black, text, dark ? '#394039' : '#e5dfd0'),
		blue: ink(colors.blue, dark ? '#9ecddd' : '#315f78', dark ? '#283e48' : '#d9e5e6'),
		green: ink(colors.green, dark ? '#aad2a7' : '#366248', dark ? '#304337' : '#dce5d5'),
		violet: ink(colors.violet, dark ? '#d8b4d2' : '#73536f', dark ? '#463846' : '#e8dce3'),
		orange: ink(colors.orange, dark ? '#f3b28a' : '#984a29', dark ? '#4f382d' : '#eedacc'),
	}
}

// Lyra Forge chart colors. Magenta marks the timing or decision that needs attention.
function admiraltyColors(dark: boolean): TLThemeColors {
	const colors = DEFAULT_THEME.colors[dark ? 'dark' : 'light']
	const background = dark ? '#0b1e36' : '#f4f7f8'
	const text = dark ? '#f4f7f8' : '#0f2a4a'
	return {
		...colors, background, text,
		black: ink(colors.black, text, dark ? '#2a4568' : '#c9d6e0'),
		blue: ink(colors.blue, dark ? '#a9bdd4' : '#3d5674', dark ? '#0f2a4a' : '#cfe4ee'),
		violet: ink(colors.violet, dark ? '#f06aa8' : '#c2266f', dark ? '#482845' : '#f4e7ef'),
	}
}

export const canvasThemes = {
	press: { ...DEFAULT_THEME, id: 'press', strokeWidth: 1.6, colors: { light: pressColors(false), dark: pressColors(true) } },
	admiralty: { ...DEFAULT_THEME, id: 'admiralty', strokeWidth: 1.6, colors: { light: admiraltyColors(false), dark: admiraltyColors(true) } },
} satisfies Record<'press' | 'admiralty', TLTheme>
