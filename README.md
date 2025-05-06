# UNICHAIN Frontend

This is a minimal working frontend to:

- Connect to the UNICHAIN mainnet
- Deploy a FixedAPYFarm via FarmFactory
- Explore deployed farms

## Usage

1. Run `npm install`
2. Then `npm run dev`
3. Open http://localhost:3000

## Cursor Prompt to Start

```
Use this frontend template to finish the following:

- Create /create page to dynamically render form fields from FixedAPYFarm schema
- Encode initData using ethers.utils.defaultAbiCoder.encode
- Call deployFarm() on the factory

- Create /explore page that fetches deployed farms and decodes getMetadata()

FarmFactory: 0x640a39f30b9f95bbdca00691abb455b98bd13a4e
Schema: metadata/farmTypes/FixedAPYFarm.json
UNICHAIN ONLY.
```
