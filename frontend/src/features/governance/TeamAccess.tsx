import { useEffect, useState } from 'react';
import { StaffManager } from './StaffManager';
import { shopGov } from './api';

/** Team & Access for the signed-in owner: loads the plan's staff limit, then shows the staff manager. */
export function TeamAccess({ selfId }: { selfId: number }) {
  const [max, setMax] = useState(0);
  useEffect(() => { void shopGov.experience().then((x) => setMax(x.max_staff)).catch(() => undefined); }, []);
  return <StaffManager api={shopGov} selfId={selfId} maxStaff={max} />;
}
