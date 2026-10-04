package com.wxsted.reminthhome;

import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;

/** A soft dark fade over the lower part of the screen, under the buttons. Not clickable, not focusable. */
public class Shade extends AbstractWidget {
	private final int w, h;

	public Shade(int w, int h) {
		super(0, 0, w, h, Component.empty());
		this.w = w;
		this.h = h;
		this.active = false;
	}

	@Override
	protected void extractWidgetRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
		try {
			g.fillGradient(0, h * 2 / 5, w, h, 0x00000000, 0xA6000000);
		} catch (Throwable t) {
			ReminthHomeClient.drawFailed(t);
		}
	}

	@Override
	protected void updateWidgetNarration(NarrationElementOutput out) {
	}

	@Override
	public boolean isMouseOver(double x, double y) {
		return false;
	}
}
