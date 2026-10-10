package com.wxsted.reminthhud.client.panel;

import java.util.ArrayList;
import java.util.List;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * Stream Text (owner, 10 Oct: "type stuff on the screen with different sizes and colors like streamers do"): eight
 * lines of your own text anywhere on the screen. Each has its own text (with &c colour codes and | for a new line),
 * size, colour or rainbow, bold / italic / underline, outline, an animation and a box. Typed and dragged in the Stream
 * Text studio (TextStudioScreen), which every one of the eight cards opens.
 */
public final class StreamText extends Module {
	public static final int COUNT = 8;
	static final String[] SAMPLES = {"Welcome to the stream!", "&cLIVE &fnow", "Road to 1000 followers", "!discord in chat", "Be right back", "Goal: 50 wins", "Thanks for the follow!", "Your text here"};

	final int index;
	final Opt.Label hText = opt(new Opt.Label("Text"));
	final Opt.Text text;
	final Opt.Bool codes = opt(new Opt.Bool("codes", "& colour codes (&c red, &l bold...)", true));
	final Opt.Bool lines = opt(new Opt.Bool("lines", "| starts a new line", true));
	final Opt.Label hLook = opt(new Opt.Label("Size and colour"));
	final Opt.Num size = opt(new Opt.Num("size", "Size", 0.5, 8, 0.25, 2, "x"));
	final Opt.Choice colorMode = opt(new Opt.Choice("colorMode", "Colour", 0, "One colour", "Rainbow", "Rainbow letters", "Fade two colours", "Pick a shade"));
	final Opt.Color color = opt(new Opt.Color("color", "Main colour", 0xFFFFFFFF));
	final Opt.Color color2 = opt(new Opt.Color("color2", "Second colour (fade)", 0xFF55FFFF));
	final Opt.Num hue = opt(new Opt.Num("hue", "Shade: hue", 0, 360, 5, 200, ""));
	final Opt.Num sat = opt(new Opt.Num("sat", "Shade: strength", 0, 100, 5, 80, "%"));
	final Opt.Num bright = opt(new Opt.Num("bright", "Shade: brightness", 10, 100, 5, 100, "%"));
	final Opt.Num opacity = opt(new Opt.Num("opacity", "Text opacity", 10, 100, 5, 100, "%"));
	final Opt.Label hStyle = opt(new Opt.Label("Style"));
	final Opt.Bool bold = opt(new Opt.Bool("bold", "Bold", true));
	final Opt.Bool italic = opt(new Opt.Bool("italic", "Italic", false));
	final Opt.Bool underline = opt(new Opt.Bool("underline", "Underline", false));
	final Opt.Bool strike = opt(new Opt.Bool("strike", "Strikethrough", false));
	final Opt.Bool shadow = opt(new Opt.Bool("shadow", "Shadow", true));
	final Opt.Bool outline = opt(new Opt.Bool("outline", "Outline", false));
	final Opt.Color outlineColor = opt(new Opt.Color("outlineColor", "Outline colour", 0xFF000000));
	final Opt.Choice align = opt(new Opt.Choice("align", "Line alignment", 0, "Left", "Centre", "Right"));
	final Opt.Num spacing = opt(new Opt.Num("spacing", "Line spacing", 0, 10, 1, 2, ""));
	final Opt.Label hAnim = opt(new Opt.Label("Animation"));
	final Opt.Choice effect = opt(new Opt.Choice("effect", "Animation", 0, "None", "Blink", "Pulse", "Wave", "Bounce", "Shake", "Typewriter", "Scroll", "Fade in and out"));
	final Opt.Num speed = opt(new Opt.Num("speed", "Speed", 0.2, 5, 0.1, 1, "x"));
	final Opt.Num scrollWidth = opt(new Opt.Num("scrollWidth", "Scroll: box width", 40, 400, 10, 160, ""));
	final Opt.Label hBox = opt(new Opt.Label("Box"));
	final Opt.Bool box = opt(new Opt.Bool("box", "Background box", false));
	final Opt.Color boxColor = opt(new Opt.Color("boxColor", "Box colour", 0xFF000000));
	final Opt.Num boxOpacity = opt(new Opt.Num("boxOpacity", "Box opacity", 0, 100, 5, 50, "%"));
	final Opt.Bool border = opt(new Opt.Bool("border", "Border", false));
	final Opt.Color borderColor = opt(new Opt.Color("borderColor", "Border colour", 0xFFFFFFFF));
	final Opt.Num padding = opt(new Opt.Num("padding", "Padding", 0, 12, 1, 3, ""));
	final Opt.Bool accentBar = opt(new Opt.Bool("accentBar", "Colour bar on the left", false));

	StreamText(int index) {
		super("streamtext" + (index + 1), "Screen Text " + (index + 1), Cat.STREAM, "screentext", "Your own text on screen: any size, colour, style and animation. Type it and drag it in the studio.", true, false, Anchor.TOP_LEFT, 8, 30 + index * 26);
		this.index = index;
		this.text = new Opt.Text("text", "Text", SAMPLES[index], 120);
		opts.add(1, text);
	}

	static List<Module> all() {
		List<Module> l = new ArrayList<>();
		for (int i = 0; i < COUNT; i++) l.add(new StreamText(i));
		return l;
	}

	@Override
	public Screen optionsScreen(Screen back) {
		return new TextStudioScreen(back, index);
	}

	/** The colour of letter i (of n) right now. */
	private int colorAt(int i, int n) {
		int c = switch (colorMode.value) {
			case 1 -> Draw.rainbow((float) (0.25 * speed.value), 0);
			case 2 -> Draw.rainbow((float) (0.25 * speed.value), -i / (float) Math.max(8, n));
			case 3 -> {
				double t = (Math.sin(System.currentTimeMillis() / 1000.0 * speed.value * 2 + i * 0.25) + 1) / 2;
				yield Draw.mix(color.value, color2.value, (float) t);
			}
			case 4 -> Draw.hsb((float) (hue.value / 360.0), (float) (sat.value / 100.0), (float) (bright.value / 100.0));
			default -> color.value;
		};
		return Draw.alpha(c, opacity.value / 100.0 * fadeAlpha());
	}

	private double fadeAlpha() {
		double t = System.currentTimeMillis() / 1000.0 * speed.value;
		return switch (effect.value) {
			case 2 -> 0.55 + 0.45 * (Math.sin(t * 4) + 1) / 2;
			case 8 -> Math.max(0.05, (Math.sin(t * 2) + 1) / 2);
			default -> 1;
		};
	}

	private MutableComponent styled(String s) {
		MutableComponent c = Component.literal(s);
		if (bold.value) c = c.withStyle(ChatFormatting.BOLD);
		if (italic.value) c = c.withStyle(ChatFormatting.ITALIC);
		if (underline.value) c = c.withStyle(ChatFormatting.UNDERLINE);
		if (strike.value) c = c.withStyle(ChatFormatting.STRIKETHROUGH);
		return c;
	}

	/** The text with &x codes turned into the game's colour codes (when on). */
	String shownText() {
		String t = text.value.isEmpty() ? " " : text.value;
		if (codes.value) t = t.replaceAll("&([0-9a-fk-orA-FK-OR])", "§$1");
		if (effect.value == 6) { // typewriter: letters appear one by one, then a pause
			int n = t.length();
			int step = (int) ((System.currentTimeMillis() / (110 / speed.value)) % (n + 18));
			t = t.substring(0, Math.min(n, step));
		}
		return t;
	}

	private boolean perLetter() {
		return colorMode.value == 2 || colorMode.value == 3 || effect.value == 3 || effect.value == 4 || effect.value == 5;
	}

	@Override
	public void render(Gfx g, Minecraft mc, boolean preview) {
		if (StreamKeys.textsHidden && !preview) {
			lastW = 1;
			lastH = 1;
			return;
		}
		if (effect.value == 1 && !preview && (System.currentTimeMillis() / (long) (500 / speed.value)) % 2 == 1) {
			return; // blink: keep the last size so the layout doesn't jump
		}
		Font font = Draw.font();
		String all = shownText();
		String[] rows = lines.value ? all.split("\\|", -1) : new String[] {all};
		float sz = (float) size.value;
		int pad = (int) padding.value;
		int lineH = 9 + (int) spacing.value;
		int maxW = 0;
		int[] widths = new int[rows.length];
		for (int i = 0; i < rows.length; i++) {
			widths[i] = font.width(styled(rows[i]));
			maxW = Math.max(maxW, widths[i]);
		}
		boolean scroll = effect.value == 7;
		int innerW = scroll ? (int) scrollWidth.value : maxW;
		int innerH = rows.length * lineH - (int) spacing.value;
		int bar = accentBar.value ? 3 : 0;
		int boxW = innerW + pad * 2 + bar, boxH = innerH + pad * 2;
		g.push();
		g.scale(sz, sz);
		try {
			if (box.value && boxOpacity.value > 0) Draw.round(g, 0, 0, boxW, boxH, 2, Draw.alpha(boxColor.value, boxOpacity.value / 100.0));
			if (border.value) g.outline(0, 0, boxW, boxH, borderColor.value);
			if (bar > 0) g.fill(0, 0, 2, boxH, colorAt(0, 1) | 0xFF000000);
			if (scroll) g.enableScissor(pad + bar, 0, pad + bar + innerW, boxH);
			int letters = Math.max(1, all.length());
			int seen = 0;
			for (int r = 0; r < rows.length; r++) {
				String row = rows[r];
				int x = pad + bar + switch (align.value) {
					case 1 -> (innerW - widths[r]) / 2;
					case 2 -> innerW - widths[r];
					default -> 0;
				};
				int y = pad + r * lineH;
				if (scroll) {
					int span = widths[r] + innerW;
					x = pad + bar + innerW - (int) ((System.currentTimeMillis() / (25 / speed.value)) % Math.max(1, span));
				}
				if (perLetter()) {
					String plain = ChatFormatting.stripFormatting(row);
					int cx = x;
					for (int i = 0; i < plain.length(); i++) {
						String ch = String.valueOf(plain.charAt(i));
						double t = System.currentTimeMillis() / 1000.0 * speed.value;
						int oy = switch (effect.value) {
							case 3 -> (int) Math.round(Math.sin(t * 6 + (seen + i) * 0.5) * 2);
							case 4 -> (int) -Math.round(Math.abs(Math.sin(t * 4 + (seen + i) * 0.35)) * 3);
							default -> 0;
						};
						int ox = effect.value == 5 ? (int) Math.round(Math.sin(t * 40 + i * 7) * 0.8) : 0;
						if (effect.value == 5) oy = (int) Math.round(Math.cos(t * 37 + i * 5) * 0.8);
						draw(g, font, styled(ch), cx + ox, y + oy, colorAt(seen + i, letters));
						cx += font.width(styled(ch));
					}
					seen += plain.length();
				} else {
					draw(g, font, styled(row), x, y, colorAt(0, 1));
				}
			}
			if (scroll) g.disableScissor();
		} finally {
			g.pop();
		}
		lastW = Math.round(boxW * sz);
		lastH = Math.round(boxH * sz);
	}

	private void draw(Gfx g, Font font, Component c, int x, int y, int color) {
		if (outline.value) {
			int oc = Draw.alpha(outlineColor.value, ((color >>> 24) & 0xFF) / 255.0);
			Component plain = Component.literal(ChatFormatting.stripFormatting(c.getString())).withStyle(c.getStyle());
			g.text(font, plain, x - 1, y, oc, false);
			g.text(font, plain, x + 1, y, oc, false);
			g.text(font, plain, x, y - 1, oc, false);
			g.text(font, plain, x, y + 1, oc, false);
		}
		g.text(font, c, x, y, color, shadow.value && !outline.value);
	}
}
