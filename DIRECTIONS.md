# Tutorial: Building and Managing Farms with the Dynamic Farm Factory

This tutorial explains the architecture and process for creating, managing, and interacting with different types of staking farms using the `FarmFactory` system.

**Core Concepts:**

1.  **`FarmFactory.sol`:** A central contract responsible for deploying new farm contracts. It does *not* contain the specific logic for any particular farm type. Its key job is to clone existing implementation contracts using a generic `deployFarm(bytes32 farmType, bytes calldata initData, ...)` function.
2.  **Farm Implementations (e.g., `EnhancedFixedAPYFarm.sol`):** These are separate contracts containing the actual logic for a specific type of farm (staking rules, reward calculations, locking mechanisms, etc.). They are designed to be "cloned" by the factory. Crucially, they have an `initialize(bytes memory data)` function to set up their specific parameters *after* being cloned, decoding the `initData` provided by the factory.
3.  **`IFarm.sol`:** An interface standardizing common functions expected across all farm types (like `initialize(bytes)`, `getMetadata`, `stake`, `claim`, `unstake`, etc.). This helps ensure compatibility.
4.  **`farmType` (bytes32):** A unique identifier (a hash) representing a specific farm type (e.g., "EnhancedFixedAPYFarm_v1"). This is calculated in the frontend from a descriptive string.
5.  **Registration:** The *owner* of the `FarmFactory` must register each new farm *implementation contract* address, associating it with a specific `farmType` hash using the factory's `registerFarmType` function. This tells the factory which code to clone when a user requests that type.
6.  **Metadata Schemas (`.json`):** For each farm type, a corresponding JSON file (e.g., `EnhancedFixedAPYFarm_v1.json`) is stored in the frontend (`metadata/farmTypes/`). These schemas describe the farm for the UI:
    *   `type`: The unique string identifier used to calculate the `farmType` hash (e.g., "EnhancedFixedAPYFarm_v1").
    *   `implementationAddress`: The on-chain address of the deployed implementation contract for this type. (Used by frontend for reference/verification, not directly by factory).
    *   `initFields`: An array describing the inputs needed from the user on the `/create` page to construct the `initialize` call data (excluding owner/duration which are handled differently). Can include `label` and `placeholder` for the UI.
    *   `metadataFields`: An array describing the structure and types of data returned by the farm's `getMetadata()` view function. Used by `/explore` and `/farm/[address]` to decode and display farm info.
    *   `actions`: Defines the interaction functions available on this farm type (like `stake`, `unstake`, `claim`), used by `/farm/[address]`.
    *   `tags`: An array of keywords used for filtering/categorization on the `/explore` page (e.g., `["fixed", "apy", "lock", "boost"]`).
7.  **Frontend Dynamism:** The frontend reads these schemas to dynamically build the creation form, display farm cards, and provide interaction controls.

**How to Add a Completely New Farm Type (e.g., "LotteryFarm")**

1.  **Create the Smart Contract (`contracts/Farms/LotteryFarm.sol`)**
    *   Implement `IFarm`.
    *   `initialize(bytes memory data)`: Must use `abi.decode` to unpack args specific to this lottery farm (e.g., `ticketPrice`, `drawInterval`).
    *   `getMetadata()`: Must return `abi.encode`d data specific to the lottery (e.g., `nextDrawTime`, `prizePool`).
    *   Implement lottery-specific logic (e.g., `buyTicket`, `conductDraw`, `claimPrize`).

2.  **Create the Metadata Schema (`metadata/farmTypes/LotteryFarm.json`)**
    *   Define `"type": "LotteryFarm"`.
    *   Add `"implementationAddress": "PLACEHOLDER_..."`.
    *   List the necessary user inputs in `initFields` (e.g., `ticketPrice`, `drawIntervalDays`).
    *   List the return values of `getMetadata` in `metadataFields`.
    *   Define relevant `actions` (e.g., `buyTicket`, `claimPrize`).
    *   Add descriptive `tags` (e.g., `["lottery", "game"]`).

3.  **Compile & Deploy LotteryFarm**
    *   Compile `LotteryFarm.sol`.
    *   Deploy it to UNICHAIN.
    *   Record the new implementation address.

4.  **Update `LotteryFarm.json`**
    *   Replace the placeholder implementation address with the real one.

5.  **Register with Factory**
    *   Calculate the `farmType` hash for `"LotteryFarm"`.
    *   The owner of the **currently deployed factory** (`0x5d07...050b`) calls `registerFarmType` on the factory, passing the calculated hash and the new LotteryFarm implementation address.

6.  **Update Frontend Config (`utils/web3.ts` and `pages/create.tsx`)**
    *   **`utils/web3.ts`**: Add the compiled ABI for `LotteryFarm.sol` as a new constant (e.g., `LOTTERY_FARM_ABI`).
    *   **`pages/create.tsx`**:
        *   Statically import the new schema: `import schema_lottery from '../metadata/farmTypes/LotteryFarm.json';`
        *   Add it to the `schemas` map: `"LotteryFarm.json": schema_lottery`
        *   Add it to the `availableFarmTypes` map: `"Lottery Farm": "LotteryFarm.json"`
        *   **Crucially:** Update `validateInitialInputs` and `handleDeploy` to correctly format the `args` array and encode the `initData` using the appropriate types and ABI (`LOTTERY_FARM_ABI`) when `"LotteryFarm"` is selected.

7.  **Update Frontend UI (`/explore` and `/farm/[address]`) - Future Enhancement**
    *   These pages currently assume all farms use `CURRENT_FARM_IMPLEMENTATION_ABI`.
    *   To support diverse farms, they need to:
        *   Determine the `farmType` of each displayed/viewed farm (requires changes to factory or event indexing).
        *   Load the correct schema based on the type.
        *   Use `metadataFields` from the schema to dynamically decode/display info.
        *   Use `actions` from the schema to render correct buttons.
        *   Use the correct ABI (`LOTTERY_FARM_ABI`, etc.) for interactions.

**Fee Implementation Notes:**

*   **Creator Fee:** Can be implemented via the factory's `setDeploymentFee` function (owner sets fee, users pay via `msg.value` on `deployFarm`).
*   **Staker Fee:** Requires modifying the specific farm implementation contract (`EnhancedFixedAPYFarm.sol`, `LotteryFarm.sol`, etc.) within the relevant functions (`stake`, `claim`, `unstake`) to transfer a percentage/fixed amount to a platform wallet. Frontend fees are insecure.

**Current Setup (as of last successful edit):**

*   Frontend supports creating "Enhanced Fixed APY Farm (v2)".
*   Factory (`0x5d07...050b`) uses generic `initData`.
*   Farm implementation (`0x2904...F154`) uses `initialize(bytes data)`.
*   Explore/Detail pages assume all farms are of the `CURRENT_FARM_IMPLEMENTATION_ABI` type. 