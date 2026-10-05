package com.wxsted.reminthhome;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.network.chat.Component;

/**
 * A real button (keyboard and narrator work as for any button) drawn as a near-black tile with slightly
 * rounded corners and a faint border. With an icon it shows the icon instead of text.
 * This is the copy for Minecraft 1.21-1.21.1.
 */
public class RoundButton extends AbstractButton {
	private final Runnable action;
	private final ResourceLocation icon; // 32x32 texture, or null for a text button
	private final int radius;
	private static volatile boolean broken = false;

	public RoundButton(int x, int y, int w, int h, Component label, ResourceLocation icon, int radius, Runnable action) {
		super(x, y, w, h, label);
		this.action = action;
		this.icon = icon;
		this.radius = radius;
	}

	@Override
	public void onPress() {
		action.run();
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput out) {
		defaultButtonNarrationText(out);
	}

	/** How far a row is pulled in from the edge to round a corner of radius r. */
	static int inset(int r, int row) {
		if (row >= r) return 0;
		double dy = r - row - 0.5;
		return r - (int) Math.round(Math.sqrt(r * (double) r - dy * dy));
	}

	/** A rounded rectangle with a 1 px border, border and fill never overlapping (both may be translucent). */
	static void tile(GuiGraphics g, int x, int y, int w, int h, int r, int border, int fill) {
		for (int i = 0; i < h; i++) {
			int o = inset(r, Math.min(i, h - 1 - i));
			if (i == 0 || i == h - 1) {
				g.fill(x + o, y + i, x + w - o, y + i + 1, border);
				continue;
			}
			int in = Math.max(o + 1, 1 + inset(Math.max(r - 1, 0), Math.min(i - 1, h - 2 - i)));
			g.fill(x + o, y + i, x + in, y + i + 1, border);
			g.fill(x + w - in, y + i, x + w - o, y + i + 1, border);
			g.fill(x + in, y + i, x + w - in, y + i + 1, fill);
		}
	}

	@Override
	protected void renderWidget(GuiGraphics g, int mouseX, int mouseY, float delta) {
		if (broken) return;
		try {
			draw(g);
		} catch (Throwable t) {
			broken = true;
			ReminthHomeClient.drawFailed(t);
		}
	}

	private void draw(GuiGraphics g) {
		boolean hot = isHoveredOrFocused() && active;
		int fill = hot ? 0xF02A2A30 : 0xE60B0B0D;
		int border = hot ? 0x80FFFFFF : 0x2AFFFFFF;
		tile(g, getX(), getY(), getWidth(), getHeight(), radius, border, fill);
		int tint = !active ? 0xFF6E6E76 : hot ? 0xFFFFFFFF : 0xFFD6D6DB;
		Minecraft mc = Minecraft.getInstance();
		if (icon != null) {
			int s = Math.min(16, Math.min(getWidth(), getHeight()) - 6);
			g.blit(icon, getX() + (getWidth() - s) / 2, getY() + (getHeight() - s) / 2, s, s, 0f, 0f, 64, 64, 64, 64);
		} else {
			g.drawCenteredString(mc.font, getMessage(), getX() + getWidth() / 2, getY() + (getHeight() - 8) / 2, tint);
		}
	}
}
