# Changelog

## [0.1.0](https://github.com/MovieMaker93/Sparkfire/compare/v0.1.0...v0.1.0) (2026-10-11)


### Features

* **ui:** give Sparkfire a warm palette and an ember accent ([5d3a758](https://github.com/MovieMaker93/Sparkfire/commit/5d3a7582bfad725efc9bb9328bb87df1aad9458e))
* **ui:** give Sparkfire its own ember look ([a5c5894](https://github.com/MovieMaker93/Sparkfire/commit/a5c5894042fe0970d20a8095397002e6676987ab))
* **ui:** mark the active page and running work in ember ([972bf08](https://github.com/MovieMaker93/Sparkfire/commit/972bf085e57f8a0a4e846db16e93ca0573e5f522))
* **ui:** switch to Geist and Bricolage Grotesque ([d0ae715](https://github.com/MovieMaker93/Sparkfire/commit/d0ae715f33c38cc22a71221f0a4d30640a61cca4))
* **ui:** tighten corners and drop pill buttons ([e549e8e](https://github.com/MovieMaker93/Sparkfire/commit/e549e8ec2f365b361c5bfa071bb7cf08b2fd654b))


### Bug fixes

* **store:** serialize changes to a job's manifest ([894bcee](https://github.com/MovieMaker93/Sparkfire/commit/894bcee907524fb858e2358aa4dc3e88245b87f8))
* **ui:** take graph and preview colours from the theme ([1b7fbea](https://github.com/MovieMaker93/Sparkfire/commit/1b7fbea18904522d752b7f668ec6498e83f4caa0))


### Documentation

* describe the ember interface ([98ae42c](https://github.com/MovieMaker93/Sparkfire/commit/98ae42cd59ed951d948d393944b2fef6ff8eb2af))
* **media:** record the tour and clips with the ember interface ([a6689ab](https://github.com/MovieMaker93/Sparkfire/commit/a6689abc1103334877c90178c9dc92a44a6cf204))

## [0.1.0](https://github.com/MovieMaker93/Sparkfire/compare/v0.1.5...v0.1.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* the published image moves from ghcr.io/<owner>/sparklingkit to ghcr.io/<owner>/sparkfire, and distribution/install.sh is gone.
* **dgx:** start-dgx-spark.sh no longer builds, downloads or starts the video service unless --video-backend fasth3 is passed, and a restart without it stops a running video service.

### Features

* **asr:** add a Parakeet adapter with the OpenAI transcription route ([d7553e3](https://github.com/MovieMaker93/Sparkfire/commit/d7553e31224c3fb16d90286f6128fbdf36444773))
* **asr:** build sentences, subtitle cues and paragraphs from word timestamps ([151970d](https://github.com/MovieMaker93/Sparkfire/commit/151970d456ff0a9071d8470162f49064dcbc4f34))
* **asr:** make Parakeet the default speech recognition backend ([a90ab75](https://github.com/MovieMaker93/Sparkfire/commit/a90ab75d995057e058f01a27d263cc707e314c10))
* **asr:** package parakeet.cpp for the DGX Spark ([611b327](https://github.com/MovieMaker93/Sparkfire/commit/611b327983b0c5d4b7a4eaff125e2055e03d96f3))
* **asr:** request word timestamps from Parakeet ([7b56582](https://github.com/MovieMaker93/Sparkfire/commit/7b5658216dd5facac06c7712024fc0c2f2ef9127))
* **asr:** write sentence lines and subtitle cues from word timestamps ([23ff788](https://github.com/MovieMaker93/Sparkfire/commit/23ff788458c531f1246595f28016df181e649976))
* **chat:** let the model search the web and read pages ([85eabd0](https://github.com/MovieMaker93/Sparkfire/commit/85eabd060b31535d8c8f2d82d31034059325c199))
* **dgx:** add an opt-in SearXNG for chat web search ([b9ee3ae](https://github.com/MovieMaker93/Sparkfire/commit/b9ee3ae98bf1dd826763c4d97f7d7c67e7fa3483))
* **dgx:** drop the bundled LLM, Qwen3-ASR and grounding services ([79bad49](https://github.com/MovieMaker93/Sparkfire/commit/79bad49c66a0162e05eaea0fe0366204e7c03d91))
* **dgx:** drop the bundled LocateAnything grounding service ([6e3a8c9](https://github.com/MovieMaker93/Sparkfire/commit/6e3a8c9e57f8c8cfaae57b8510b51dc72dd46269))
* **dgx:** drop the bundled Qwen3.6 LLM from the reference stack ([51c8ded](https://github.com/MovieMaker93/Sparkfire/commit/51c8dedc9fb339dcc82b0db1d727b03b293cdaaf))
* **dgx:** drop the Qwen3-ASR backend; Parakeet is the only speech service ([4bb1bdf](https://github.com/MovieMaker93/Sparkfire/commit/4bb1bdf7d5d90949df8682a6f8745a50db493d1e))
* **dgx:** make FastH3 video generation opt-in ([f41e66a](https://github.com/MovieMaker93/Sparkfire/commit/f41e66a2c5ef6958579a2797ad33c504ae1cf9c6))
* **dgx:** make Parakeet the default speech backend of the start script ([c52e28e](https://github.com/MovieMaker93/Sparkfire/commit/c52e28eb0b99a0c43e04b6500a393de482940d91))
* **dgx:** run FastH3 video generation in the reference stack ([03ff048](https://github.com/MovieMaker93/Sparkfire/commit/03ff048ba2d637e3225908ec5d9d4c3c59419e80))
* read SPARKFIRE_* environment variables ([a4ffe6f](https://github.com/MovieMaker93/Sparkfire/commit/a4ffe6f70f3cbe4b6eac931108c25e2b6a6e0cd7))
* **ui:** add the Sparkfire mark ([d2e3f3a](https://github.com/MovieMaker93/Sparkfire/commit/d2e3f3afb97415a0e30dee1db0782147d24d4d72))
* **ui:** add the Sparkfire mark ([3423884](https://github.com/MovieMaker93/Sparkfire/commit/3423884118a321dc4d152a4aa3906feba9bf6367))
* **ui:** hide grounding until a grounding endpoint is configured ([662f0c2](https://github.com/MovieMaker93/Sparkfire/commit/662f0c25a1e39044ecfb71e29cd83ca024e81f7b))
* **ui:** hide grounding until a grounding endpoint is configured ([145980e](https://github.com/MovieMaker93/Sparkfire/commit/145980ee237cb08ea0adb1f86030e1a6c2f88895))
* **ui:** offer video generation on the workbench instead of grounding ([f3372a6](https://github.com/MovieMaker93/Sparkfire/commit/f3372a6ae9945690bb9faab17203e08551af95a5))
* **ui:** rename the product to Sparkfire ([dac7baa](https://github.com/MovieMaker93/Sparkfire/commit/dac7baa12fbd5751f6b10ac914b9ef9b17ba5447))
* **video:** add a FastH3 video service driven through ComfyUI ([5c50f1f](https://github.com/MovieMaker93/Sparkfire/commit/5c50f1ffcb170c071b721b14d77d8315c4adfa20))
* **video:** add FastH3 text-to-video with sound ([c063bd8](https://github.com/MovieMaker93/Sparkfire/commit/c063bd8e3e87d73bf10ec4a01d35b9b94ddb46e1))
* **video:** add the text-to-video module ([8b7bb24](https://github.com/MovieMaker93/Sparkfire/commit/8b7bb247cf9754f5145d048b7ad5a5e79eac6cf1))
* **video:** offer 10-second videos ([6430549](https://github.com/MovieMaker93/Sparkfire/commit/6430549e9ce73d5055872b2f08bec9d97965a44a))
* **video:** offer 10-second videos ([d8932db](https://github.com/MovieMaker93/Sparkfire/commit/d8932dbce067143def0e462e6696541aad9c2dc4))


### Bug fixes

* **asr:** drop Parakeet's &lt;unk&gt; marks from words ([ad960b5](https://github.com/MovieMaker93/Sparkfire/commit/ad960b56a4b9682703a38df8b4eac411d1631b86))
* **asr:** keep chunk text when an ASR returns no word times ([46888aa](https://github.com/MovieMaker93/Sparkfire/commit/46888aa0da7fb11a1396279852260f65081b3971))
* **asr:** keep subtitle cues within their caps when punctuation tokens follow ([22012fa](https://github.com/MovieMaker93/Sparkfire/commit/22012fa37395819861b9bd16478ffd3733e8de70))
* **asr:** run the Parakeet container without root and with a health check ([b6baee3](https://github.com/MovieMaker93/Sparkfire/commit/b6baee30fb74ab92783bfda4541835a70b7f79fc))
* **asr:** send Parakeet chunks of at most 30 seconds ([3d5c35f](https://github.com/MovieMaker93/Sparkfire/commit/3d5c35f9578cc7658f1c33682b6d5f308bbcc9af))
* **asr:** strip Qwen3-ASR language tags anywhere in a transcript ([bc69103](https://github.com/MovieMaker93/Sparkfire/commit/bc69103e37db43686e4d263dd60ee0e97195b219))
* **chat:** keep answers going when the page leaves the chat ([887cfc4](https://github.com/MovieMaker93/Sparkfire/commit/887cfc42aa71b78359f4319da734c2791a2c318f))
* **chat:** keep answers going when the page leaves the chat ([e776c88](https://github.com/MovieMaker93/Sparkfire/commit/e776c882dae44f87f4c349cb1647371cae29c502))
* **deps:** patch security advisories in production dependencies ([980c5c2](https://github.com/MovieMaker93/Sparkfire/commit/980c5c2dd0ce5d63cfb4aa9405dbccead44f942d))
* **dgx:** default split installs and the demo to the Parakeet model id ([2941be1](https://github.com/MovieMaker93/Sparkfire/commit/2941be1b3d37548e36b33316406c08415c705a7c))
* **dgx:** name the Parakeet engine from its command line ([fd0d639](https://github.com/MovieMaker93/Sparkfire/commit/fd0d6396583e59664b2f3fdbe22cc424aa799b13))
* **dgx:** report only the services the stack runs in status ([03e95a3](https://github.com/MovieMaker93/Sparkfire/commit/03e95a35912651cef8bc346e3d298bda9935db57))
* **dgx:** start Parakeet through its readiness variables ([f0c6a61](https://github.com/MovieMaker93/Sparkfire/commit/f0c6a61a897f0a17d1a59d3ff39c4c863d0c1a21))
* **dgx:** stop and remove containers of the retired services ([2445239](https://github.com/MovieMaker93/Sparkfire/commit/24452392f742b04368e6c5e22839cdf81779f2dd))
* **media:** forward only the status route through the demo proxy ([e257921](https://github.com/MovieMaker93/Sparkfire/commit/e257921dc2e8fee1db7451974f97b7c338a39501))
* patch dependency advisories, add CI/CD and make the fork public-ready ([cfd3145](https://github.com/MovieMaker93/Sparkfire/commit/cfd31458e4c0f02f234a2e7c04526dcf499cdf8f))
* **ui:** point footer, update check and onboarding at the fork ([403ac9a](https://github.com/MovieMaker93/Sparkfire/commit/403ac9a3fc0c874e32afb1e7ffd39fd77a4ec6d7))
* **video:** create ComfyUI's base folders before starting it ([12e4999](https://github.com/MovieMaker93/Sparkfire/commit/12e499928d992fcb193fc536ea5f084c1a008886))


### Dependencies

* **dgx:** bump python-multipart to 0.0.31 in the adapters ([eed61c5](https://github.com/MovieMaker93/Sparkfire/commit/eed61c5a56a711b6aee58f9049966d0fd0461e34))


### Documentation

* add per-container memory tables and Saluki's context size ([f095164](https://github.com/MovieMaker93/Sparkfire/commit/f0951647d4090c3a2d7b2cfb93fa8454ae127277))
* add the Sparkfire notice above SparklingKit's ([00bb9c8](https://github.com/MovieMaker93/Sparkfire/commit/00bb9c843ebeb0d69291588ded3292395ceff512))
* advise keeping the queue at two workers on a Spark ([acfe2d6](https://github.com/MovieMaker93/Sparkfire/commit/acfe2d6acf7a5d32c7b0ecaaf73131d7b2bbafdf))
* **agents:** fix the memory rule after the stack lost its LLM ([396b088](https://github.com/MovieMaker93/Sparkfire/commit/396b0881798ac8a7dd0d49112161510b79391644))
* **asr:** design Parakeet as the default speech recognition backend ([531cd6e](https://github.com/MovieMaker93/Sparkfire/commit/531cd6e3c2d3f32aea6f38a748793b31eae1f5af))
* **asr:** document Parakeet as the default speech backend ([5790d88](https://github.com/MovieMaker93/Sparkfire/commit/5790d88b72b83a74131fc22b372a3729f5328f2f))
* **asr:** plan the Parakeet backend and refine its timing rules ([43256b3](https://github.com/MovieMaker93/Sparkfire/commit/43256b332597bfe90830cc785cd3b97dbd5b9ce5))
* describe chat web search ([89ecd7d](https://github.com/MovieMaker93/Sparkfire/commit/89ecd7d962467121eebb0e18a3fd27a83f493e01))
* describe FastH3 video as on by default ([37bdeed](https://github.com/MovieMaker93/Sparkfire/commit/37bdeedf2655e86ad700b9faf6caeea8b1611311))
* describe Sparkfire and credit SparklingKit ([cb9aff0](https://github.com/MovieMaker93/Sparkfire/commit/cb9aff0a3dd5a56f6efd9487fcc908296a4c6d8d))
* describe the CI and release process and Conventional Commits ([1dd91c1](https://github.com/MovieMaker93/Sparkfire/commit/1dd91c10251fbc2df73b4b7c5d137d573c38a517))
* **dgx:** explain upgrading from the six-model stack ([373d980](https://github.com/MovieMaker93/Sparkfire/commit/373d980ac34bb6158e28274be3042b1b1b7a02fe))
* **media:** record the tour with video and web search at full resolution ([8ce6928](https://github.com/MovieMaker93/Sparkfire/commit/8ce69287e653cf2c751d18a8b2c4e9a4de575a30))
* **readme:** explain the video trade-offs and credit its authors ([bb0c3cd](https://github.com/MovieMaker93/Sparkfire/commit/bb0c3cd4413cb328e3c7082c030de8eefbeff4f9))
* **readme:** rewrite the README around a feature tour recorded from the real app ([9e2e71e](https://github.com/MovieMaker93/Sparkfire/commit/9e2e71ef54d90a3387a27566cb12a9988cff6f35))
* **readme:** rewrite the README around what Sparkfire does today ([1f51b01](https://github.com/MovieMaker93/Sparkfire/commit/1f51b0118d14b86cae0d41aad65996fcfd9acfc9))
* **validation:** check parakeet.cpp v0.6.1 and load the Parakeet stack ([7df5b23](https://github.com/MovieMaker93/Sparkfire/commit/7df5b23fce175b6a6bfbae3c935a9f6735778b50))
* **validation:** correct the Parakeet chunk lengths and long-file figures ([cbf4b12](https://github.com/MovieMaker93/Sparkfire/commit/cbf4b1274ab2d77272c7bdc9cb02caa61bba00e0))
* **validation:** mark removed services in the memory tables ([99e183f](https://github.com/MovieMaker93/Sparkfire/commit/99e183fa310ecb6b26c0b7700fcb34c469b31a85))
* **validation:** record Parakeet results through the app ([6d1cc3b](https://github.com/MovieMaker93/Sparkfire/commit/6d1cc3bb70cd793cc34386aa6679ad17017c40e0))
* **validation:** record Parakeet with 30-second chunks against Qwen3-ASR ([5b95d41](https://github.com/MovieMaker93/Sparkfire/commit/5b95d414219bebd46c6a1d5f2327585804f547bf))
* **validation:** record the FastH3 video bake-off on the Spark ([b6d5081](https://github.com/MovieMaker93/Sparkfire/commit/b6d5081c03b7238b842564da4bcc09cd95111ba9))
* **validation:** record the FastH3 video bake-off on the Spark ([4236d6c](https://github.com/MovieMaker93/Sparkfire/commit/4236d6cdc2a66bcc73b243e4da07bb524786b98d))
* **validation:** record the FastH3 video service on the Spark ([291e338](https://github.com/MovieMaker93/Sparkfire/commit/291e3388cc8f3b56b576c8d87a53914da35fd99a))
* **video:** document text-to-video, its service and its license ([32c13de](https://github.com/MovieMaker93/Sparkfire/commit/32c13de3201ceccfbadb2c61f36e63ebdd422c39))


### Build

* drop upstream's installers and release workflows ([c7cd5ff](https://github.com/MovieMaker93/Sparkfire/commit/c7cd5ff10b2e16b8834cc400c10263e05df12365))
