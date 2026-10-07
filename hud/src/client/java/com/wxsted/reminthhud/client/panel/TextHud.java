package com.wxsted.reminthhud.client.panel;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** A HUD feature that is one line of text ("FPS 240"), with a background, colours and shadow as options. */
public abstract class TextHud extends Module {
	protected final Opt.Bool background = opt(new Opt.Bool("background", "Background", true));
	protected final Opt.Num bgOpacity = opt(new Opt.Num("bgOpacity", "Background opacity", 0, 100, 5, 45, "%"));
	protected final Opt.Color labelColor = opt(new Opt.Color("labelColor", "Label colour", 0xFFB4B4B8));
	protected final Opt.Color valueColor = opt(new Opt.Color("valueColor", "Value colour", 0xFFFFFFFF));
	protected final Opt.Bool shadow = opt(new Opt.Bool("shadow", "Text shadow", true));

	protected TextHud(String id, String name, String icon, String description, boolean defaultOn, Anchor anchor, int dx, int dy) {
		super(id, name, Cat.HUD, icon, description, false, defaultOn, anchor, dx, dy);
	}

	/** The label ("FPS") or "" for none. */
	protected abstract String label(Minecraft mc);

	/** The value ("240"), or null to draw nothing (outside the editor). */
	protected abstract String value(Minecraft mc, boolean preview);

	@Override
	public void render(GuiGraphicsExtractor g, Minecraft mc, boolean preview) {
		String v = value(mc, preview);
		if (v == null) return;
		String l = label(mc);
		var font = Draw.font();
		int lw = l.isEmpty() ? 0 : font.width(l) + 4;
		int w = lw + font.width(v) + 8;
		int h = 15;
		if (background.value) Draw.round(g, 0, 0, w, h, 3, ((int) Math.round(bgOpacity.value * 2.55) << 24));
		if (!l.isEmpty()) g.text(font, l, 4, 4, labelColor.value, shadow.value);
		g.text(font, v, 4 + lw, 4, valueColor.value, shadow.value);
		lastW = w;
		lastH = h;
	}
}
