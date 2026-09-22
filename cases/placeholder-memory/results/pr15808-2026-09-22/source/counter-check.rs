extern crate rspack_allocator;
use std::hint::black_box;
use std::alloc::{Layout, alloc, alloc_zeroed, dealloc, realloc};
fn main() {
  let before = rspack_allocator::benchmark_memory(true);
  unsafe {
    let initial = Layout::from_size_align(4096, 16).unwrap();
    let p = black_box(alloc(black_box(initial)));
    assert!(!p.is_null());
    let after_alloc = rspack_allocator::benchmark_memory(false);
    assert_eq!(after_alloc[0] - before[0], 4096.0);
    let p = black_box(realloc(black_box(p), initial, black_box(8192)));
    assert!(!p.is_null());
    let after_grow = rspack_allocator::benchmark_memory(false);
    assert_eq!(after_grow[0] - before[0], 8192.0);
    let p = black_box(realloc(black_box(p), Layout::from_size_align(8192, 16).unwrap(), black_box(1024)));
    assert!(!p.is_null());
    let after_shrink = rspack_allocator::benchmark_memory(false);
    assert_eq!(after_shrink[0] - before[0], 1024.0);
    dealloc(p, Layout::from_size_align(1024, 16).unwrap());
    let p = black_box(alloc_zeroed(black_box(initial)));
    assert!(!p.is_null());
    assert_eq!(std::slice::from_raw_parts(p, 4096), &[0u8; 4096]);
    dealloc(p, initial);
  }
  let after = rspack_allocator::benchmark_memory(false);
  assert_eq!(after[0], before[0]);
  assert_eq!(after[1] - before[0], 8192.0);
  assert_eq!(after[2] - before[2], 4096.0 + 8192.0 + 1024.0 + 4096.0);
  assert_eq!(after[3] - before[3], 4.0);
  println!("allocator counters: alloc/zeroed/realloc grow/shrink/free/peak OK");
}
