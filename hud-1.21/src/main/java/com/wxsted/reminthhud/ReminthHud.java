package com.wxsted.reminthhud;

import net.fabricmc.api.ModInitializer;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ReminthHud implements ModInitializer {
	public static final String MOD_ID = "reminthhud";

	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	@Override
	public void onInitialize() {
		LOGGER.info("ReminthHUD loaded");
	}
}
