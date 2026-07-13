# Adds the two shield extensions to the Xcode project.
#
# ShieldConfiguration draws the screen you meet when you open a blocked app;
# ShieldAction handles its buttons. Both need Family Controls and the App Group,
# because they read and write the same history the app does.
#
# Idempotent: run it twice and nothing changes.
#
#   gem install xcodeproj && ruby add-shield-targets.rb

require "xcodeproj"

PROJECT = "YawningFace.xcodeproj"
APP_TARGET = "YawningFace"
GROUP_ID = "group.yawningface.block"
TEAM = "25B5ZT342A"

project = Xcodeproj::Project.open(PROJECT)
app = project.targets.find { |t| t.name == APP_TARGET }
raise "app target not found" unless app

EXTENSIONS = [
  {
    name: "ShieldConfigurationExtension",
    class: "ShieldConfigurationExtension",
    point: "com.apple.ManagedSettingsUI.shield-configuration-service",
    frameworks: %w[ManagedSettings ManagedSettingsUI],
  },
  {
    name: "ShieldActionExtension",
    class: "ShieldActionExtension",
    point: "com.apple.ManagedSettings.shield-action-service",
    frameworks: %w[ManagedSettings DeviceActivity],
  },
]

EXTENSIONS.each do |ext|
  if project.targets.any? { |t| t.name == ext[:name] }
    puts "#{ext[:name]}: already present"
    next
  end

  target = project.new_target(
    :app_extension,
    ext[:name],
    :ios,
    "16.0",
    nil,
    :swift
  )

  # Sources
  group = project.main_group.find_subpath(ext[:name], true)
  group.set_source_tree("SOURCE_ROOT")
  group.set_path(ext[:name])
  file = group.new_reference("#{ext[:name]}.swift")
  target.add_file_references([file])

  # Info.plist: the extension point is what makes iOS treat it as a shield.
  plist_path = File.join(ext[:name], "Info.plist")
  # CFBundleIdentifier must be here: without it the embedded binary gets an
  # empty bundle id and Xcode rejects it for not being prefixed by the app's.
  File.write(plist_path, <<~PLIST)
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>CFBundleDevelopmentRegion</key>
      <string>$(DEVELOPMENT_LANGUAGE)</string>
      <key>CFBundleDisplayName</key>
      <string>#{ext[:name]}</string>
      <key>CFBundleExecutable</key>
      <string>$(EXECUTABLE_NAME)</string>
      <key>CFBundleIdentifier</key>
      <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
      <key>CFBundleInfoDictionaryVersion</key>
      <string>6.0</string>
      <key>CFBundleName</key>
      <string>$(PRODUCT_NAME)</string>
      <key>CFBundlePackageType</key>
      <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
      <key>CFBundleShortVersionString</key>
      <string>1.0</string>
      <key>CFBundleVersion</key>
      <string>1</string>
      <key>NSExtension</key>
      <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>#{ext[:point]}</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).#{ext[:class]}</string>
      </dict>
    </dict>
    </plist>
  PLIST

  # Entitlements: Family Controls plus the App Group, or it cannot read history.
  ent_path = File.join(ext[:name], "#{ext[:name]}.entitlements")
  File.write(ent_path, <<~ENT)
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>com.apple.developer.family-controls</key>
      <true/>
      <key>com.apple.security.application-groups</key>
      <array>
        <string>#{GROUP_ID}</string>
      </array>
    </dict>
    </plist>
  ENT

  target.build_configurations.each do |config|
    s = config.build_settings
    s["PRODUCT_BUNDLE_IDENTIFIER"] = "yawningface.block.#{ext[:name]}"
    s["PRODUCT_NAME"] = "$(TARGET_NAME)"
    s["INFOPLIST_FILE"] = plist_path
    s["CODE_SIGN_ENTITLEMENTS"] = ent_path
    s["CODE_SIGN_STYLE"] = "Automatic"
    s["DEVELOPMENT_TEAM"] = TEAM
    s["SWIFT_VERSION"] = "5.0"
    s["IPHONEOS_DEPLOYMENT_TARGET"] = "16.0"
    s["SKIP_INSTALL"] = "YES"
    s["TARGETED_DEVICE_FAMILY"] = "1,2"
    s["GENERATE_INFOPLIST_FILE"] = "NO"
  end

  # Link the frameworks the extension actually calls.
  frameworks_group = project.frameworks_group
  ext[:frameworks].each do |name|
    ref = frameworks_group.new_reference("System/Library/Frameworks/#{name}.framework")
    ref.source_tree = "SDKROOT"
    target.frameworks_build_phase.add_file_reference(ref)
  end

  # Embed it in the app, and make the app depend on it.
  app.add_dependency(target)
  embed = app.build_phases.find { |p|
    p.respond_to?(:name) && p.name == "Embed Foundation Extensions"
  }
  embed ||= app.new_copy_files_build_phase("Embed Foundation Extensions")
  embed.symbol_dst_subfolder_spec = :plug_ins
  build_file = embed.add_file_reference(target.product_reference)
  build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

  puts "#{ext[:name]}: added"
end

project.save
puts "saved #{PROJECT}"
