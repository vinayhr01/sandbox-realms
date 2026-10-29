/**
 * Powers whose icon is an existing building or flora art (referenced, not copied). Filled in with the Peoples icons
 * (design spec, Approaches 3). Keyed by power id; `chunk` is the art chunk the id is read from.
 */
export const REUSE: Record<string, { chunk: 'buildings'; id: string }> = {
  ins_list_hamlets: { chunk: 'buildings', id: 'house' },
  ins_layer_l02: { chunk: 'buildings', id: 'dwelling_1' },
};
