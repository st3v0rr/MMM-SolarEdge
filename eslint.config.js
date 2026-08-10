const js = require("@eslint/js");

module.exports = [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "script",
			globals: {
				console: "readonly",
				module: "readonly",
				require: "readonly",
				setInterval: "readonly",
			},
		},
	},
];
