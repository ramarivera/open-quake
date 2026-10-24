/** Synthetic HA REST catalog shared by consumer regressions and the native mock. */
export const groupedServices = [
	{
		domain: "light",
		services: {
			turn_on: {
				name: "Turn on",
				fields: {
					brightness: {
						name: "Brightness",
						required: true,
						selector: { number: { min: 0, max: 255 } },
					},
					advanced_fields: {
						name: "Advanced",
						collapsed: true,
						fields: {
							transition: {
								name: "Transition",
								required: true,
								selector: { number: { min: 0, max: 60 } },
							},
							nested: {
								collapsed: true,
								fields: {
									effect: {
										name: "Effect",
										selector: { select: { options: ["rainbow", "pulse"] } },
									},
								},
							},
						},
					},
				},
			},
		},
	},
];
