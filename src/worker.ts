import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { TASK_QUEUE } from './shared';

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

async function run() {
  const connection = await NativeConnection.connect({ address: ADDRESS });
  try {
    const worker = await Worker.create({
      connection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('./workflows'),
      activities,
    });
    console.log(`🛠️  Worker polling "${TASK_QUEUE}" on ${ADDRESS}. Ctrl+C to kill it and watch a room survive.`);
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
