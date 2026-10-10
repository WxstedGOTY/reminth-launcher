package com.wxsted.reminthhud.client.panel;

/**
 * The panel's own settings (SETTINGS tab): how see-through and how big it is, its accent colour, whether you can walk
 * while it is open and whether E closes it. Saved with the profile like a feature, but never shown as a card.
 */
public final class PanelLook extends Module {
	public final Opt.Num opacity = opt(new Opt.Num("opacity", "Panel opacity", 15, 100, 5, 55, "%"));
	public final Opt.Num size = opt(new Opt.Num("size", "Panel size", 70, 115, 5, 100, "%"));
	public final Opt.Color accent = opt(new Opt.Color("accent", "Accent colour", 0xFFFFFFFF));
	public final Opt.Bool dim = opt(new Opt.Bool("dim", "Darken the game behind it", false));
	public final Opt.Bool walk = opt(new Opt.Bool("walk", "Walk while it is open (W A S D, jump, sprint, sneak)", true));
	public final Opt.Bool inventoryCloses = opt(new Opt.Bool("eCloses", "The inventory key (E) closes it", true));
	public final Opt.Bool tooltips = opt(new Opt.Bool("tooltips", "Descriptions when hovering a card", true));
	public final Opt.Bool compact = opt(new Opt.Bool("compact", "Four cards a row", false));
	public final Opt.Choice openOn = opt(new Opt.Choice("openTab", "Opens on", 0, "Last category", "All", "HUD", "Streamer"));

	PanelLook() {
		super("panellook", "Panel Look", Cat.UTILITY, "gear", "How the Reminth panel itself looks and works.", false, true, null, 0, 0);
		hidden = true;
	}

	public static PanelLook get() {
		return (PanelLook) Panel.byId("panellook");
	}

	/** Sets Draw's colours for this frame. */
	public void apply() {
		Draw.applyStyle((float) (opacity.value / 100.0), accent.value);
	}
}
