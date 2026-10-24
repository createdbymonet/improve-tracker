<script lang="ts">
	import brandMark from '../lib/assets/favicon.svg';
</script>

<svelte:head>
	<title>Improve Tracker — Coming Soon</title>
	<meta
		name="description"
		content="Small steps. Consistent progress. Improve Tracker is a study habit tracker in the making, designed to help you build learning routines and track daily progress."
	/>
</svelte:head>

<div class="page">
	<header class="site-header">
		<div class="brand">
			<img src={brandMark} alt="" width="40" height="40" />
			<span>Improve Tracker</span>
		</div>
		<span class="header-note">A little better, every day.</span>
	</header>

	<main>
		<section class="hero" aria-labelledby="hero-title">
			<div class="hero__content">
				<p class="status"><span aria-hidden="true"></span> Coming Soon</p>
				<h1 id="hero-title">
					Small steps.<br />
					Consistent <em>progress.</em>
				</h1>
				<p class="hero__description">
					A simpler way to build study habits and see your daily learning add up. A little focus
					today, a little more confidence tomorrow.
				</p>
				<p class="hero__footnote">Your next chapter of learning starts here.</p>
			</div>

			<div class="growth-art" aria-hidden="true">
				<svg viewBox="0 0 460 460" fill="none">
					<circle cx="230" cy="230" r="200" fill="#EBEFE3" />
					<circle cx="338" cy="106" r="29" fill="#D8DFB5" />
					<path d="M63 366h334" stroke="#CDD6C7" stroke-linecap="round" stroke-width="2" />
					<rect x="85" y="296" width="78" height="70" rx="10" fill="#D3DDC7" />
					<path d="M163 252a10 10 0 0 1 10-10h68v124h-78V252Z" fill="#B0C4A3" />
					<path d="M241 198a10 10 0 0 1 10-10h68v178h-78V198Z" fill="#769B77" />
					<path
						d="M319 144a10 10 0 0 1 10-10h58a10 10 0 0 1 10 10v212a10 10 0 0 1-10 10h-68V144Z"
						fill="#35654D"
					/>
					<path d="M166 187c0-29-20-48-47-49 0 27 17 48 47 49Z" fill="#9AAF83" />
					<path d="M166 166c0-29 18-48 43-50 0 26-15 47-43 50Z" fill="#35654D" />
					<path d="M166 214v-58" stroke="#35654D" stroke-linecap="round" stroke-width="3" />
					<circle cx="85" cy="240" r="4" fill="#9AAF83" />
					<circle cx="269" cy="102" r="3" fill="#9AAF83" />
					<circle cx="411" cy="225" r="4" fill="#9AAF83" />
				</svg>
				<p>Room to grow.</p>
			</div>
		</section>
	</main>

	<footer class="site-footer">
		<p>Built around learning. Made for your own pace.</p>
		<p class="footer-note">
			<span aria-hidden="true">↗</span> Better habits begin with a small step.
		</p>
	</footer>
</div>

<style lang="scss">
	.page {
		display: flex;
		min-height: 100svh;
		max-width: 1440px;
		flex-direction: column;
		margin-inline: auto;
		padding-inline: clamp(1.5rem, 5vw, 4.5rem);
	}

	.site-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		padding-block: 2.5rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		font-size: 1.1rem;
		font-weight: 650;
		letter-spacing: -0.035em;

		img {
			flex-shrink: 0;
		}
	}

	.header-note {
		color: var(--color-muted);
		font-size: 0.8125rem;
	}

	main {
		display: grid;
		flex: 1;
		align-items: center;
		padding-block: 3.5rem 5rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
		align-items: center;
		gap: 2rem;

		&__content {
			padding-bottom: 1rem;
		}

		&__description {
			max-width: 29rem;
			margin-top: 1.75rem;
			color: var(--color-muted);
			font-size: 1.0625rem;
			line-height: 1.8;
			text-wrap: pretty;
		}

		&__footnote {
			margin-top: 2.5rem;
			padding-left: 0.9rem;
			border-left: 2px solid #a2b78d;
			color: var(--color-muted);
			font-size: 0.8125rem;
			line-height: 1.6;
		}
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.75rem;
		padding: 0.5rem 0.8rem;
		border: 1px solid #d8e0cf;
		border-radius: 2rem;
		background: #eaf0e2;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1;

		span {
			width: 0.375rem;
			height: 0.375rem;
			border-radius: 50%;
			background: var(--color-accent);
		}
	}

	h1 {
		font-size: clamp(2.75rem, 5.1vw, 4.6rem);
		font-weight: 550;
		letter-spacing: -0.06em;
		line-height: 1.12;

		em {
			color: var(--color-accent);
			font-family: Georgia, 'Times New Roman', serif;
			font-weight: 400;
			letter-spacing: -0.065em;
		}
	}

	.growth-art {
		width: 100%;
		max-width: 29rem;
		justify-self: center;

		p {
			margin-top: 0.5rem;
			color: var(--color-muted);
			font-family: Georgia, 'Times New Roman', serif;
			font-size: 1.0625rem;
			font-style: italic;
			text-align: center;
		}
	}

	.site-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 2rem;
		padding-block: 1.5rem 2rem;
		border-top: 1px solid var(--color-line);
		color: var(--color-muted);
		font-size: 0.75rem;
		line-height: 1.6;
	}

	.footer-note {
		display: flex;
		align-items: center;
		gap: 0.5rem;

		span {
			font-size: 1rem;
		}
	}

	@media (max-width: 900px) {
		.hero {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
			gap: 1rem;
		}

		h1 {
			font-size: clamp(2.75rem, 5.5vw, 3.5rem);
		}

		.site-footer {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.5rem;
		}
	}

	@media (max-width: 640px) {
		.site-header {
			padding-block: 1.5rem;
		}

		.header-note {
			display: none;
		}

		main {
			padding-block: 2.5rem 3rem;
		}

		.hero {
			grid-template-columns: minmax(0, 1fr);
			gap: 2.25rem;

			&__content {
				padding-bottom: 0;
			}

			&__description {
				margin-top: 1.5rem;
				font-size: 1rem;
			}

			&__footnote {
				margin-top: 1.75rem;
			}
		}

		h1 {
			font-size: clamp(2.5rem, 8.5vw, 3.5rem);
		}

		.growth-art {
			max-width: 19rem;
		}

		.site-footer {
			padding-block: 1.25rem 1.5rem;
		}
	}
</style>
