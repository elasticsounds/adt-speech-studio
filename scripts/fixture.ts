import { makeFixture } from '../tests/fixture.js'
const target = process.argv[2] ?? '.context/plant-explorer-adt.zip'
await makeFixture(target)
console.log(target)
