package com.wxsted.reminthhud.client.panel;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * A HUD feature that is one line of text ("FPS 240"). Every one of them has the same long list of looks: its own label
 * text, colours, rainbow, bold, brackets, background colour and opacity, border, rounded corners and padding.
 */
public abstract class TextHud extends Module {
	protected final Opt.Label hText = opt(new Opt.Label("Text"));
	protected final Opt.Bool showLabel = opt(new Opt.Bool("showLabel", "Show the label", true));
	protected final Opt.Text customLabel = opt(new Opt.Text("customLabel", "Own label (empty = normal)", "", 24));
	protected final Opt.Bool labelAfter = opt(new Opt.Bool("labelAfter", "Label after the value", false));
	protected final Opt.Color labelColor = opt(new Opt.Color("labelColor", "Label colour", 0xFFB4B4B8));
	protected final Opt.Color valueColor = opt(new Opt.Color("valueColor", "Value colour", 0xFFFFFFFF));
	protected final Opt.Bool rainbow = opt(new Opt.Bool("rainbow", "Rainbow text", false));
	protected final Opt.Num rainbowSpeed = opt(new Opt.Num("rainbowSpeed", "Rainbow speed", 0.1, 2, 0.1, 0.5, "x"));
	protected final Opt.Bool bold = opt(new Opt.Bool("bold", "Bold", false));
	protected final Opt.Bool upper = opt(new Opt.Bool("upper", "ALL CAPS", false));
	protected final Opt.Choice brackets = opt(new Opt.Choice("brackets", "Brackets", 0, "None", "[ ]", "( )", "< >", "{ }"));
	protected final Opt.Bool shadow = opt(new Opt.Bool("shadow", "Text shadow", true));
	protected final Opt.Label hBox = opt(new Opt.Label("Box"));
	protected final Opt.Bool background = opt(new Opt.Bool("background", "Background", true));
	protected final Opt.Color bgColor = opt(new Opt.Color("bgColor", "Background colour", 0xFF000000));
	protected final Opt.Num bgOpacity = opt(new Opt.Num("bgOpacity", "Background opacity", 0, 100, 5, 45, "%"));
	protected final Opt.Bool border = opt(new Opt.Bool("border", "Border", false));
	protected final Opt.Color borderColor = opt(new Opt.Color("borderColor", "Border colour", 0xFFFFFFFF));
	protected final Opt.Num corners = opt(new Opt.Num("corners", "Rounded corners", 0, 7, 1, 3, ""));
	protected final Opt.Num padding = opt(new Opt.Num("padding", "Padding", 1, 10, 1, 4, ""));
	protected final Opt.Num minWidth = opt(new Opt.Num("minWidth", "Fixed width (0 = fits the text)", 0, 200, 5, 0, ""));

	protected TextHud(String id, String name, String icon, String description, boolean defaultOn, Anchor anchor, int dx, int dy) {
		this(id, name, Cat.HUD, icon, description, defaultOn, anchor, dx, dy);
	}

	protected TextHud(String id, String name, Cat cat, String icon, String description, boolean defaultOn, Anchor anchor, int dx, int dy) {
		super(id, name, cat, icon, description, false, defaultOn, anchor, dx, dy);
	}

	/** The label ("FPS") or "" for none. */
	protected abstract String label(Minecraft mc);

	/** The value ("240"), or null to draw nothing (outside the editor). */
	protected abstract String value(Minecraft mc, boolean preview);

	private MutableComponent styled(String s, int color) {
		if (upper.value) s = s.toUpperCase(java.util.Locale.ROOT);
		MutableComponent c = Component.literal(s);
		if (bold.value) c = c.withStyle(ChatFormatting.BOLD);
		return c;
	}

	@Override
	public void render(Gfx g, Minecraft mc, boolean preview) {
		String v = value(mc, preview);
		if (v == null) return;
		if (Features5.hides(this)) v = "Hidden"; // Streamer Mode
		String l = !showLabel.value ? "" : customLabel.value.isEmpty() ? label(mc) : customLabel.value;
		String[] br = {"", "", "[", "]", "(", ")", "<", ">", "{", "}"};
		v = br[brackets.value * 2] + v + br[brackets.value * 2 + 1];
		var font = Draw.font();
		int lc = rainbow.value ? Draw.rainbow((float) rainbowSpeed.value, 0f) : labelColor.value;
		int vc = rainbow.value ? Draw.rainbow((float) rainbowSpeed.value, 0.15f) : valueColor.value;
		MutableComponent lt = styled(l, lc), vt = styled(v, vc);
		int pad = (int) padding.value;
		int lw = l.isEmpty() ? 0 : font.width(lt) + 4;
		int w = Math.max((int) minWidth.value, lw + font.width(vt) + pad * 2);
		int h = 7 + pad * 2;
		int r = (int) corners.value;
		if (background.value && bgOpacity.value > 0) Draw.round(g, 0, 0, w, h, r, Draw.alpha(bgColor.value, bgOpacity.value / 100.0));
		if (border.value) g.outline(-1, -1, w + 2, h + 2, borderColor.value);
		int tx = pad + Math.max(0, (w - pad * 2 - lw - font.width(vt)) / 2);
		if (labelAfter.value) {
			g.text(font, vt, tx, pad, vc, shadow.value);
			if (!l.isEmpty()) g.text(font, lt, tx + font.width(vt) + 4, pad, lc, shadow.value);
		} else {
			if (!l.isEmpty()) g.text(font, lt, tx, pad, lc, shadow.value);
			g.text(font, vt, tx + lw, pad, vc, shadow.value);
		}
		lastW = w;
		lastH = h;
	}
}
