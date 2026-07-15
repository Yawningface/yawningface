# Compiles YawningFace/Enforcement.swift into the two shield-applying extensions.
#
# The app target's YawningFace folder is an Xcode 16 *synchronized* group, so it
# already compiles Enforcement.swift automatically - we must NOT add it there
# again or it double-compiles. The extension targets are classic targets, so
# they need an explicit file reference pointing back at the shared file.
#
# Idempotent. Run on the mini after syncing:
#   gem install xcodeproj && ruby add-enforcement-file.rb

require "xcodeproj"

PROJECT = "YawningFace.xcodeproj"
REL_PATH = "YawningFace/Enforcement.swift"   # relative to SOURCE_ROOT (the .xcodeproj dir)
EXTENSION_TARGETS = %w[DeviceActivityMonitorExtension ShieldActionExtension]

project = Xcodeproj::Project.open(PROJECT)

# One shared reference, in a "Shared" classic group, source-tree SOURCE_ROOT.
shared = project.main_group.find_subpath("Shared", true)
shared.set_source_tree("SOURCE_ROOT")
ref = shared.files.find { |f| f.path == REL_PATH }
unless ref
  ref = shared.new_reference(REL_PATH)
  ref.source_tree = "SOURCE_ROOT"
end

EXTENSION_TARGETS.each do |name|
  target = project.targets.find { |t| t.name == name }
  raise "target #{name} not found" unless target

  if target.source_build_phase.files_references.include?(ref)
    puts "#{name}: already compiles Enforcement.swift"
  else
    target.add_file_references([ref])
    puts "#{name}: added Enforcement.swift"
  end
end

project.save
puts "saved #{PROJECT}"
